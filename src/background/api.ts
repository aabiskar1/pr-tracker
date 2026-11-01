import browser from 'webextension-polyfill';
import type {
    GitHubIssueSearchItem,
    GitHubReview,
    CIStatus,
    GitHubCheckRun,
    PullRequest,
} from '../types';
import {
    analyzeGitHubHttpError,
    type GitHubApiErrorInfo,
} from '../utils/githubApiError';
import {
    selectLatestGitHubRateLimitCooldown,
    type GitHubRateLimitCooldown,
} from '../utils/githubRateLimit';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import {
    assertRefreshSessionValid,
    type RefreshSessionContext,
} from './refreshSession';

export type PullRequestFetchResult =
    | {
          status: 'success';
          pullRequests: PullRequest[];
          rateLimit?: GitHubRateLimitCooldown;
      }
    | { status: 'failure'; rateLimit?: GitHubRateLimitCooldown };

export type ApiErrorInfo = GitHubApiErrorInfo;

type ReviewStatus = 'approved' | 'changes-requested' | 'pending';
type OptionalStatusResult<TStatus extends string> = {
    status: TStatus;
    rateLimit?: GitHubRateLimitCooldown;
};
type DetailedPullRequestResult =
    | {
          status: 'success';
          pullRequest: PullRequest;
          rateLimit?: GitHubRateLimitCooldown;
      }
    | {
          status: 'failure';
          response?: Response;
          rateLimit?: GitHubRateLimitCooldown;
      };
type SearchFetchResult =
    | { status: 'success'; items: GitHubIssueSearchItem[] }
    | { status: 'failure'; context: string; response?: Response };

// Constants
const NOTIFICATION_ICON = 'icons/icon-128.png';
const SEARCH_RESULTS_PER_PAGE = 100;
const SEARCH_RESULT_LIMIT = 1000;
const SEARCH_MAX_PAGES = SEARCH_RESULT_LIMIT / SEARCH_RESULTS_PER_PAGE;
const REVIEWS_PER_PAGE = 100;
const REVIEWS_MAX_PAGES = 10;
const CI_CHECKS_PER_PAGE = 100;
const CI_CHECKS_MAX_PAGES = 10;
const CI_CHECKS_RESULT_LIMIT = CI_CHECKS_PER_PAGE * CI_CHECKS_MAX_PAGES;
// Four PRs keep the popup refresh responsive while bounding the optional
// review/CI fan-out far below GitHub's changeable secondary-limit ceilings.
export const PR_DETAIL_CONCURRENCY = 4;

// Error handling
export const analyzeHttpError = analyzeGitHubHttpError;

export async function handleApiError(
    response: Response,
    createNotification: (
        id: string | undefined,
        options: {
            type: 'basic';
            iconUrl: string;
            title: string;
            message: string;
        },
        forceShow?: boolean
    ) => Promise<void>,
    context: string = 'API request',
    refreshSession?: RefreshSessionContext
): Promise<ApiErrorInfo> {
    assertRefreshSessionValid(refreshSession);
    const errorInfo = await analyzeHttpError(response);
    assertRefreshSessionValid(refreshSession);
    console.error(
        `${context} failed with status: ${response.status}`,
        errorInfo
    );

    await createNotification(
        undefined,
        {
            type: 'basic',
            iconUrl: NOTIFICATION_ICON,
            title: 'PR Tracker Error',
            message: errorInfo.message,
        },
        errorInfo.isAuth
    );
    assertRefreshSessionValid(refreshSession);

    browser.runtime.sendMessage({
        type: 'SHOW_ERROR',
        message: errorInfo.message,
    });

    return errorInfo;
}

// API Functions
function getNextReviewPageUrl(
    linkHeader: string | null,
    currentUrl: string,
    reviewsUrl: string,
    nextPage: number
): string | null {
    if (!linkHeader) return null;

    let nextUrl: string | null = null;
    for (const link of linkHeader.split(',')) {
        const match = /^\s*<([^<>]+)>;\s*rel="([^"]+)"\s*$/.exec(link);
        if (!match?.[1]) throw new Error('Invalid review pagination link');
        if (match[2] !== 'next') continue;
        if (nextUrl) throw new Error('Duplicate review next-page link');
        const target = new URL(match[1]);
        const endpoint = new URL(reviewsUrl);
        const parameters = target.searchParams;
        if (
            target.origin !== endpoint.origin ||
            target.pathname !== endpoint.pathname ||
            target.hash ||
            parameters.get('per_page') !== String(REVIEWS_PER_PAGE) ||
            parameters.get('page') !== String(nextPage) ||
            [...parameters.keys()].some(
                (key) => key !== 'per_page' && key !== 'page'
            ) ||
            [...parameters.keys()].length !== 2 ||
            target.href === currentUrl
        ) {
            throw new Error('Invalid review next-page target');
        }
        nextUrl = target.href;
    }
    return nextUrl;
}

async function getReviewStatus(
    prUrl: string,
    token: string,
    refreshSession?: RefreshSessionContext
): Promise<OptionalStatusResult<ReviewStatus>> {
    try {
        assertRefreshSessionValid(refreshSession);
        const reviewsUrl = `${prUrl}/reviews`;
        let pageUrl: string | null =
            `${reviewsUrl}?per_page=${REVIEWS_PER_PAGE}`;
        const latestReviews = new Map<number, string>();
        const visitedUrls = new Set<string>();
        for (let page = 1; page <= REVIEWS_MAX_PAGES; page++) {
            assertRefreshSessionValid(refreshSession);
            if (!pageUrl || visitedUrls.has(pageUrl))
                throw new Error('Repeated review pagination page');
            visitedUrls.add(pageUrl);
            const response = await fetch(pageUrl, {
                signal: refreshSession?.signal,
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });
            assertRefreshSessionValid(refreshSession);
            if (!response.ok) {
                const errorInfo = await analyzeHttpError(response);
                assertRefreshSessionValid(refreshSession);
                return {
                    status: 'pending',
                    ...(errorInfo.rateLimit
                        ? { rateLimit: errorInfo.rateLimit }
                        : {}),
                };
            }

            const data: unknown = await response.json();
            assertRefreshSessionValid(refreshSession);
            if (
                !Array.isArray(data) ||
                data.length > REVIEWS_PER_PAGE ||
                !data.every(
                    (review: unknown) =>
                        isRecord(review) &&
                        isRecord(review.user) &&
                        Number.isSafeInteger(review.user.id) &&
                        Number(review.user.id) >= 0 &&
                        typeof review.state === 'string' &&
                        [
                            'APPROVED',
                            'CHANGES_REQUESTED',
                            'COMMENTED',
                            'DISMISSED',
                            'PENDING',
                        ].includes(review.state)
                )
            ) {
                throw new Error('Invalid review response');
            }
            const reviews = data as GitHubReview[];
            for (const review of reviews) {
                latestReviews.set(review.user.id, review.state);
            }
            pageUrl = getNextReviewPageUrl(
                response.headers.get('link'),
                pageUrl,
                reviewsUrl,
                page + 1
            );
            assertRefreshSessionValid(refreshSession);
            if (!pageUrl) break;
            if (page === REVIEWS_MAX_PAGES)
                throw new Error('Review pagination limit reached');
        }

        assertRefreshSessionValid(refreshSession);
        const states = Array.from(latestReviews.values());
        if (states.includes('CHANGES_REQUESTED'))
            return { status: 'changes-requested' };
        if (states.includes('APPROVED')) return { status: 'approved' };
        return { status: 'pending' };
    } catch (error) {
        assertRefreshSessionValid(refreshSession);
        console.error('Error fetching review status:', error);
        return { status: 'pending' };
    }
}

async function getCIStatus(
    repoUrl: string,
    headSha: string,
    token: string,
    refreshSession?: RefreshSessionContext
): Promise<OptionalStatusResult<CIStatus>> {
    try {
        const checkRuns: GitHubCheckRun[] = [];
        const seenIds = new Set<number>();
        let totalCount: number | undefined;
        // GitHub supports at most 100 per page. Bound fan-out, retaining the
        // default latest-run filter. Never reduce a partial collection.
        for (let page = 1; page <= CI_CHECKS_MAX_PAGES; page++) {
            assertRefreshSessionValid(refreshSession);
            const checksUrl = `${repoUrl}/commits/${headSha}/check-runs?per_page=${CI_CHECKS_PER_PAGE}&page=${page}`;
            const response = await fetch(checksUrl, {
                signal: refreshSession?.signal,
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });
            assertRefreshSessionValid(refreshSession);
            if (!response.ok) {
                const errorInfo = await analyzeHttpError(response);
                assertRefreshSessionValid(refreshSession);
                return {
                    status: 'unknown',
                    ...(errorInfo.rateLimit
                        ? { rateLimit: errorInfo.rateLimit }
                        : {}),
                };
            }
            const data = await response.json();
            assertRefreshSessionValid(refreshSession);
            if (
                !isRecord(data) ||
                !Array.isArray(data.check_runs) ||
                !Number.isSafeInteger(data.total_count) ||
                Number(data.total_count) < 0 ||
                // A conservative per-PR work budget; do not evaluate beyond it.
                Number(data.total_count) > CI_CHECKS_RESULT_LIMIT ||
                (totalCount !== undefined && data.total_count !== totalCount) ||
                data.check_runs.length !==
                    Math.min(
                        CI_CHECKS_PER_PAGE,
                        Number(data.total_count) - checkRuns.length
                    ) ||
                !data.check_runs.every(
                    (run: unknown) =>
                        isRecord(run) &&
                        Number.isSafeInteger(run.id) &&
                        Number(run.id) >= 0 &&
                        [
                            'queued',
                            'in_progress',
                            'waiting',
                            'pending',
                            'requested',
                            'completed',
                        ].includes(String(run.status)) &&
                        (run.status === 'completed'
                            ? [
                                  'success',
                                  'failure',
                                  'timed_out',
                                  'cancelled',
                                  'neutral',
                                  'skipped',
                                  'action_required',
                                  'stale',
                                  'startup_failure',
                              ].includes(String(run.conclusion))
                            : run.conclusion === null)
                )
            )
                return { status: 'unknown' };
            totalCount = Number(data.total_count);
            for (const run of data.check_runs) {
                if (seenIds.has(run.id)) return { status: 'unknown' };
                seenIds.add(run.id);
                checkRuns.push(run);
            }
            if (checkRuns.length === totalCount) {
                // Contradictory pagination metadata is not proof of completeness.
                if (
                    /rel\s*=\s*["']?next\b/i.test(
                        response.headers.get('link') ?? ''
                    )
                )
                    return { status: 'unknown' };
                break;
            }
        }
        if (totalCount === undefined || checkRuns.length !== totalCount)
            return { status: 'unknown' };

        if (checkRuns.length === 0) {
            // The combined state covers ALL contexts, even when statuses is
            // paginated. We consume the authoritative summary, not a page reduction.
            // https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference
            const statusUrl = `${repoUrl}/commits/${headSha}/status`;
            assertRefreshSessionValid(refreshSession);
            const statusResp = await fetch(statusUrl, {
                signal: refreshSession?.signal,
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });
            assertRefreshSessionValid(refreshSession);
            if (statusResp.ok) {
                const statusData = await statusResp.json();
                assertRefreshSessionValid(refreshSession);
                if (
                    !isRecord(statusData) ||
                    !Array.isArray(statusData.statuses) ||
                    !['success', 'failure', 'error', 'pending'].includes(
                        String(statusData.state)
                    ) ||
                    !Number.isSafeInteger(statusData.total_count) ||
                    Number(statusData.total_count) <
                        statusData.statuses.length ||
                    statusData.statuses.length > 30 ||
                    (Number(statusData.total_count) > 0 &&
                        statusData.statuses.length !==
                            Math.min(30, Number(statusData.total_count))) ||
                    !statusData.statuses.every(
                        (context: unknown) =>
                            isRecord(context) &&
                            ['success', 'failure', 'error', 'pending'].includes(
                                String(context.state)
                            )
                    )
                )
                    return { status: 'unknown' };
                if (statusData.statuses.length === 0) {
                    return {
                        status:
                            statusData.total_count === 0 &&
                            !/rel\s*=\s*["']?next\b/i.test(
                                statusResp.headers.get('link') ?? ''
                            ) &&
                            statusData.state === 'pending'
                                ? 'no-ci'
                                : 'unknown',
                    };
                }
                if (
                    statusData.state === 'failure' ||
                    statusData.state === 'error'
                )
                    return { status: 'failing' };
                if (statusData.state === 'success')
                    return { status: 'passing' };
                if (statusData.state === 'pending')
                    return { status: 'pending' };
            } else {
                const errorInfo = await analyzeHttpError(statusResp);
                assertRefreshSessionValid(refreshSession);
                return {
                    status: 'unknown',
                    ...(errorInfo.rateLimit
                        ? { rateLimit: errorInfo.rateLimit }
                        : {}),
                };
            }
            return { status: 'unknown' };
        }

        const hasFailure = checkRuns.some(
            (run: { status: string; conclusion: string | null }) =>
                run.conclusion === 'failure' || run.conclusion === 'timed_out'
        );
        if (hasFailure) return { status: 'failing' };

        const allPassed = checkRuns.every(
            (run: { status: string; conclusion: string | null }) =>
                run.status === 'completed' && run.conclusion === 'success'
        );
        if (allPassed) return { status: 'passing' };

        return { status: 'pending' };
    } catch (error) {
        assertRefreshSessionValid(refreshSession);
        console.error('Error fetching CI status:', error);
        return { status: 'unknown' };
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const nestedRecord = (
    value: Record<string, unknown>,
    key: string
): Record<string, unknown> | undefined => {
    const nested = value[key];
    return isRecord(nested) ? nested : undefined;
};

function getCIContext(
    value: unknown
): { repoUrl: string; headSha: string } | null {
    if (!isRecord(value)) return null;

    const head = nestedRecord(value, 'head');
    const base = nestedRecord(value, 'base');
    const repo = base ? nestedRecord(base, 'repo') : undefined;
    if (
        typeof head?.sha !== 'string' ||
        head.sha.length === 0 ||
        typeof repo?.url !== 'string' ||
        repo.url.length === 0
    ) {
        return null;
    }

    return { repoUrl: repo.url, headSha: head.sha };
}

function deduplicateSearchItems(
    items: GitHubIssueSearchItem[]
): GitHubIssueSearchItem[] {
    const seenUrls = new Set<string>();
    return items.filter((item) => {
        const url = item.pull_request?.url;
        if (typeof url !== 'string' || url.length === 0) return true;
        if (seenUrls.has(url)) return false;
        seenUrls.add(url);
        return true;
    });
}

function mapPullRequestDetail(
    value: unknown,
    reviewStatus: ReviewStatus,
    ciStatus: CIStatus
): PullRequest | null {
    if (!isRecord(value)) return null;

    const id = value.id;
    const htmlUrl = value.html_url;
    if (
        typeof id !== 'number' ||
        !Number.isFinite(id) ||
        typeof htmlUrl !== 'string' ||
        htmlUrl.length === 0
    ) {
        return null;
    }

    const base = nestedRecord(value, 'base');
    const baseRepo = base ? nestedRecord(base, 'repo') : undefined;
    const repository = nestedRecord(value, 'repository');
    let repositoryName =
        typeof baseRepo?.name === 'string'
            ? baseRepo.name
            : typeof repository?.name === 'string'
              ? repository.name
              : undefined;

    if (!repositoryName) {
        try {
            repositoryName = new URL(htmlUrl).pathname.split('/')[2];
        } catch {
            return null;
        }
    }
    if (!repositoryName) return null;

    const requestedReviewers = Array.isArray(value.requested_reviewers)
        ? value.requested_reviewers.filter(
              (reviewer): reviewer is { login: string; avatar_url: string } =>
                  isRecord(reviewer) &&
                  typeof reviewer.login === 'string' &&
                  typeof reviewer.avatar_url === 'string'
          )
        : [];
    const user = nestedRecord(value, 'user');
    const author =
        typeof user?.login === 'string' && typeof user.avatar_url === 'string'
            ? { login: user.login, avatar_url: user.avatar_url }
            : undefined;

    return {
        id,
        title: typeof value.title === 'string' ? value.title : 'Untitled PR',
        html_url: htmlUrl,
        repository: { name: repositoryName },
        state: typeof value.state === 'string' ? value.state : 'open',
        draft: typeof value.draft === 'boolean' ? value.draft : false,
        created_at:
            typeof value.created_at === 'string'
                ? value.created_at
                : new Date().toISOString(),
        requested_reviewers: requestedReviewers,
        review_status: reviewStatus,
        ci_status: ciStatus,
        author,
    };
}

async function reportIncompleteRefresh(
    createNotification: (
        id: string | undefined,
        options: {
            type: 'basic';
            iconUrl: string;
            title: string;
            message: string;
        },
        forceShow?: boolean
    ) => Promise<void>,
    response?: Response,
    refreshSession?: RefreshSessionContext
): Promise<ApiErrorInfo | null> {
    assertRefreshSessionValid(refreshSession);
    const errorInfo = response ? await analyzeHttpError(response) : null;
    assertRefreshSessionValid(refreshSession);
    const message = `GitHub data could not be refreshed completely. Your cached pull requests were preserved. Please try again.${errorInfo ? ` ${errorInfo.message}` : ''}`;

    await createNotification(
        undefined,
        {
            type: 'basic',
            iconUrl: NOTIFICATION_ICON,
            title: 'PR Tracker Error',
            message,
        },
        errorInfo?.isAuth ?? false
    );
    assertRefreshSessionValid(refreshSession);
    browser.runtime.sendMessage({ type: 'SHOW_ERROR', message });
    return errorInfo;
}

function parseSearchResponse(value: unknown): {
    totalCount: number;
    incompleteResults: boolean;
    items: GitHubIssueSearchItem[];
} | null {
    if (!isRecord(value)) return null;

    const totalCount = value.total_count;
    const incompleteResults = value.incomplete_results;
    const items = value.items;
    if (
        typeof totalCount !== 'number' ||
        !Number.isInteger(totalCount) ||
        totalCount < 0 ||
        typeof incompleteResults !== 'boolean' ||
        !Array.isArray(items) ||
        items.length > SEARCH_RESULTS_PER_PAGE
    ) {
        return null;
    }

    return {
        totalCount,
        incompleteResults,
        items: items as GitHubIssueSearchItem[],
    };
}

async function fetchSearchResults(
    query: string,
    token: string,
    context: string,
    refreshSession?: RefreshSessionContext
): Promise<SearchFetchResult> {
    const items: GitHubIssueSearchItem[] = [];
    let targetCount: number | null = null;

    for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
        assertRefreshSessionValid(refreshSession);
        const pageContext = `${context} (page ${page})`;
        let response: Response;
        try {
            response = await fetch(
                `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${SEARCH_RESULTS_PER_PAGE}&page=${page}`,
                {
                    signal: refreshSession?.signal,
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github.v3+json',
                    },
                }
            );
            assertRefreshSessionValid(refreshSession);
        } catch (error) {
            assertRefreshSessionValid(refreshSession);
            console.error(`${pageContext} failed:`, error);
            return { status: 'failure', context: pageContext };
        }

        if (!response.ok) {
            return { status: 'failure', context: pageContext, response };
        }

        let rawData: unknown;
        try {
            rawData = await response.json();
            assertRefreshSessionValid(refreshSession);
        } catch (error) {
            assertRefreshSessionValid(refreshSession);
            console.error(`${pageContext} returned invalid JSON:`, error);
            return { status: 'failure', context: pageContext };
        }

        const data = parseSearchResponse(rawData);
        if (!data) {
            console.error(`${pageContext} returned an unusable response`);
            return { status: 'failure', context: pageContext };
        }
        if (data.incompleteResults) {
            console.error(`${pageContext} returned incomplete results`);
            return { status: 'failure', context: pageContext };
        }

        if (targetCount === null) {
            targetCount = Math.min(data.totalCount, SEARCH_RESULT_LIMIT);
            if (data.items.length > targetCount) {
                console.error(`${pageContext} returned an inconsistent count`);
                return { status: 'failure', context: pageContext };
            }
        }

        items.push(...data.items);
        if (items.length >= targetCount) {
            return { status: 'success', items: items.slice(0, targetCount) };
        }

        if (data.items.length < SEARCH_RESULTS_PER_PAGE) {
            console.error(`${pageContext} ended before the reported count`);
            return { status: 'failure', context: pageContext };
        }
    }

    return { status: 'success', items: items.slice(0, SEARCH_RESULT_LIMIT) };
}

async function reportSearchFailure(
    result: Extract<SearchFetchResult, { status: 'failure' }>,
    createNotification: (
        id: string | undefined,
        options: {
            type: 'basic';
            iconUrl: string;
            title: string;
            message: string;
        },
        forceShow?: boolean
    ) => Promise<void>,
    refreshSession?: RefreshSessionContext
): Promise<ApiErrorInfo | null> {
    assertRefreshSessionValid(refreshSession);
    if (result.response) {
        return handleApiError(
            result.response,
            createNotification,
            result.context,
            refreshSession
        );
    }
    return reportIncompleteRefresh(
        createNotification,
        undefined,
        refreshSession
    );
}

async function preferRateLimitedFailure<T extends { response?: Response }>(
    failures: T[]
): Promise<T> {
    for (const failure of failures) {
        if (
            failure.response &&
            (await analyzeHttpError(failure.response)).rateLimit
        ) {
            return failure;
        }
    }
    return failures[0]!;
}

export async function fetchPullRequests(
    token: string,
    user: { login: string; avatar_url: string },
    customQuery: string | undefined,
    createNotification: (
        id: string | undefined,
        options: {
            type: 'basic';
            iconUrl: string;
            title: string;
            message: string;
        },
        forceShow?: boolean
    ) => Promise<void>,
    refreshSession?: RefreshSessionContext
): Promise<PullRequestFetchResult> {
    assertRefreshSessionValid(refreshSession);
    let prItems: GitHubIssueSearchItem[] = [];
    const discoverySources = new Map<
        string,
        NonNullable<PullRequest['discoverySources']>
    >();

    if (customQuery && customQuery.trim()) {
        const customResult = await fetchSearchResults(
            customQuery,
            token,
            'Custom PR search',
            refreshSession
        );
        if (customResult.status === 'failure') {
            const errorInfo = await reportSearchFailure(
                customResult,
                createNotification,
                refreshSession
            );
            return {
                status: 'failure',
                ...(errorInfo?.rateLimit
                    ? { rateLimit: errorInfo.rateLimit }
                    : {}),
            };
        }
        prItems = customResult.items;
    } else {
        const searchQuery = `is:open is:pr author:${user.login} archived:false`;
        const assignedQuery = `is:open is:pr review-requested:${user.login} archived:false`;
        const reviewedQuery = `is:open is:pr reviewed-by:${user.login} archived:false`;

        const [authoredResult, reviewResult, reviewedResult] =
            await Promise.all([
                fetchSearchResults(
                    searchQuery,
                    token,
                    'Authored PR search',
                    refreshSession
                ),
                fetchSearchResults(
                    assignedQuery,
                    token,
                    'Review PR search',
                    refreshSession
                ),
                fetchSearchResults(
                    reviewedQuery,
                    token,
                    'Reviewed PR search',
                    refreshSession
                ),
            ]);
        assertRefreshSessionValid(refreshSession);

        if (
            authoredResult.status === 'failure' ||
            reviewResult.status === 'failure' ||
            reviewedResult.status === 'failure'
        ) {
            const searchFailures = [
                authoredResult,
                reviewResult,
                reviewedResult,
            ].filter(
                (
                    result
                ): result is Extract<
                    SearchFetchResult,
                    { status: 'failure' }
                > => result.status === 'failure'
            );
            const failure = await preferRateLimitedFailure(searchFailures);
            const errorInfo = await reportSearchFailure(
                failure,
                createNotification,
                refreshSession
            );
            return {
                status: 'failure',
                ...(errorInfo?.rateLimit
                    ? { rateLimit: errorInfo.rateLimit }
                    : {}),
            };
        }

        for (const [result, source] of [
            [authoredResult, 'authored'],
            [reviewResult, 'review-requested'],
            [reviewedResult, 'reviewed'],
        ] as const) {
            prItems.push(...result.items);
            for (const item of result.items) {
                const url = item.pull_request?.url;
                if (!url) continue;
                const sources = discoverySources.get(url) ?? [];
                if (!sources.includes(source)) sources.push(source);
                discoverySources.set(url, sources);
            }
        }
    }

    prItems = deduplicateSearchItems(prItems);

    // Canonical PR details are required and validated before optional review
    // and CI requests begin. Supporting failures degrade to "pending".
    const getPRDetails = async (
        item: GitHubIssueSearchItem,
        token: string
    ): Promise<DetailedPullRequestResult> => {
        try {
            assertRefreshSessionValid(refreshSession);
            if (
                !item.pull_request ||
                typeof item.pull_request !== 'object' ||
                !('url' in item.pull_request) ||
                typeof item.pull_request.url !== 'string'
            ) {
                console.error('Item missing pull_request URL');
                return { status: 'failure' };
            }

            const prUrl = item.pull_request.url;

            const prResponse = await fetch(prUrl, {
                signal: refreshSession?.signal,
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });
            assertRefreshSessionValid(refreshSession);

            if (!prResponse.ok) {
                console.error(
                    `Required PR detail request failed with status: ${prResponse.status}`
                );
                const errorInfo = await analyzeHttpError(prResponse);
                assertRefreshSessionValid(refreshSession);
                return {
                    status: 'failure',
                    response: prResponse,
                    ...(errorInfo.rateLimit
                        ? { rateLimit: errorInfo.rateLimit }
                        : {}),
                };
            }

            const prData: unknown = await prResponse.json();
            assertRefreshSessionValid(refreshSession);
            const pullRequest = mapPullRequestDetail(
                prData,
                'pending',
                'pending'
            );
            if (!pullRequest) {
                console.error('Required PR detail response was unusable');
                return { status: 'failure' };
            }

            const ciContext = getCIContext(prData);
            const [reviewResult, ciResult] = await Promise.all([
                getReviewStatus(prUrl, token, refreshSession),
                ciContext
                    ? getCIStatus(
                          ciContext.repoUrl,
                          ciContext.headSha,
                          token,
                          refreshSession
                      )
                    : Promise.resolve<OptionalStatusResult<CIStatus>>({
                          status: 'unknown',
                      }),
            ]);
            assertRefreshSessionValid(refreshSession);
            const rateLimit = selectLatestGitHubRateLimitCooldown([
                reviewResult.rateLimit,
                ciResult.rateLimit,
            ]);

            return {
                status: 'success',
                pullRequest: {
                    ...pullRequest,
                    ...(discoverySources.has(prUrl)
                        ? { discoverySources: discoverySources.get(prUrl) }
                        : {}),
                    review_status: reviewResult.status,
                    ci_status: ciResult.status,
                },
                ...(rateLimit ? { rateLimit } : {}),
            };
        } catch (error) {
            assertRefreshSessionValid(refreshSession);
            console.error('Error fetching PR details:', error);
            return { status: 'failure' };
        }
    };

    console.log('Fetching detailed PR information...');
    const detailResults = await mapWithConcurrency(
        prItems,
        PR_DETAIL_CONCURRENCY,
        (item) => getPRDetails(item, token),
        {
            stopScheduling: (result) =>
                result.status === 'failure' && Boolean(result.rateLimit),
        }
    );
    assertRefreshSessionValid(refreshSession);
    const failedDetails = detailResults.filter(
        (
            result
        ): result is Extract<
            DetailedPullRequestResult,
            { status: 'failure' }
        > => result.status === 'failure'
    );
    if (failedDetails.length > 0) {
        const failedDetail = await preferRateLimitedFailure(failedDetails);
        const errorInfo = await reportIncompleteRefresh(
            createNotification,
            failedDetail.response,
            refreshSession
        );
        return {
            status: 'failure',
            ...(errorInfo?.rateLimit ? { rateLimit: errorInfo.rateLimit } : {}),
        };
    }

    const successfulDetails = detailResults.filter(
        (
            result
        ): result is Extract<
            DetailedPullRequestResult,
            { status: 'success' }
        > => result.status === 'success'
    );
    const uniquePRs = Array.from(
        new Map(
            successfulDetails
                .filter(
                    (result) =>
                        // Search indexing can lag a merge/close; canonical state wins.
                        customQuery?.trim() ||
                        result.pullRequest.state === 'open'
                )
                .map((result) => [result.pullRequest.id, result.pullRequest])
        ).values()
    );

    const rateLimit = selectLatestGitHubRateLimitCooldown(
        successfulDetails.map((result) => result.rateLimit)
    );

    return {
        status: 'success',
        pullRequests: uniquePRs,
        ...(rateLimit ? { rateLimit } : {}),
    };
}
