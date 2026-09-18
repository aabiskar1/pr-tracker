import browser from 'webextension-polyfill';
import type {
    GitHubIssueSearchItem,
    GitHubReview,
    GitHubChecksResponse,
    PullRequest,
} from '../types';
import {
    analyzeGitHubHttpError,
    type GitHubApiErrorInfo,
} from '../utils/githubApiError';
import type { GitHubRateLimitCooldown } from '../utils/githubRateLimit';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';

export type PullRequestFetchResult =
    | { status: 'success'; pullRequests: PullRequest[] }
    | { status: 'failure'; rateLimit?: GitHubRateLimitCooldown };

export type ApiErrorInfo = GitHubApiErrorInfo;

type ReviewStatus = 'approved' | 'changes-requested' | 'pending';
type CIStatus = 'passing' | 'failing' | 'pending';
type DetailedPullRequestResult =
    | { status: 'success'; pullRequest: PullRequest }
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
    context: string = 'API request'
): Promise<ApiErrorInfo> {
    const errorInfo = await analyzeHttpError(response);
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

    browser.runtime.sendMessage({
        type: 'SHOW_ERROR',
        message: errorInfo.message,
    });

    return errorInfo;
}

// API Functions
async function getReviewStatus(
    prUrl: string,
    token: string
): Promise<ReviewStatus> {
    try {
        const reviewsUrl = `${prUrl}/reviews`;
        const response = await fetch(reviewsUrl, {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        if (!response.ok) return 'pending';

        const reviews: GitHubReview[] = await response.json();

        // Get latest review per user
        const latestReviews = new Map<number, string>();
        reviews.forEach((review) => {
            latestReviews.set(review.user.id, review.state);
        });

        const states = Array.from(latestReviews.values());
        if (states.includes('CHANGES_REQUESTED')) return 'changes-requested';
        if (states.includes('APPROVED')) return 'approved';
        return 'pending';
    } catch (error) {
        console.error('Error fetching review status:', error);
        return 'pending';
    }
}

async function getCIStatus(
    repoUrl: string,
    headSha: string,
    token: string
): Promise<CIStatus> {
    try {
        // Check runs
        const checksUrl = `${repoUrl}/commits/${headSha}/check-runs`;
        const response = await fetch(checksUrl, {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        if (!response.ok) return 'pending';

        const data: GitHubChecksResponse = await response.json();

        if (data.check_runs.length === 0) {
            // Fallback to combined status
            const statusUrl = `${repoUrl}/commits/${headSha}/status`;
            const statusResp = await fetch(statusUrl, {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });
            if (statusResp.ok) {
                const statusData = await statusResp.json();
                if (
                    statusData.state === 'failure' ||
                    statusData.state === 'error'
                )
                    return 'failing';
                if (statusData.state === 'success') return 'passing';
            }
            return 'pending';
        }

        const hasFailure = data.check_runs.some(
            (run) =>
                run.conclusion === 'failure' || run.conclusion === 'timed_out'
        );
        if (hasFailure) return 'failing';

        const allPassed = data.check_runs.every(
            (run) => run.status === 'completed' && run.conclusion === 'success'
        );
        if (allPassed) return 'passing';

        return 'pending';
    } catch (error) {
        console.error('Error fetching CI status:', error);
        return 'pending';
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
    response?: Response
): Promise<ApiErrorInfo | null> {
    const errorInfo = response ? await analyzeHttpError(response) : null;
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
    context: string
): Promise<SearchFetchResult> {
    const items: GitHubIssueSearchItem[] = [];
    let targetCount: number | null = null;

    for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
        const pageContext = `${context} (page ${page})`;
        let response: Response;
        try {
            response = await fetch(
                `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${SEARCH_RESULTS_PER_PAGE}&page=${page}`,
                {
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github.v3+json',
                    },
                }
            );
        } catch (error) {
            console.error(`${pageContext} failed:`, error);
            return { status: 'failure', context: pageContext };
        }

        if (!response.ok) {
            return { status: 'failure', context: pageContext, response };
        }

        let rawData: unknown;
        try {
            rawData = await response.json();
        } catch (error) {
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
    ) => Promise<void>
): Promise<ApiErrorInfo | null> {
    if (result.response) {
        return handleApiError(
            result.response,
            createNotification,
            result.context
        );
    }
    return reportIncompleteRefresh(createNotification);
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
    ) => Promise<void>
): Promise<PullRequestFetchResult> {
    let prItems: GitHubIssueSearchItem[] = [];

    if (customQuery && customQuery.trim()) {
        const customResult = await fetchSearchResults(
            customQuery,
            token,
            'Custom PR search'
        );
        if (customResult.status === 'failure') {
            const errorInfo = await reportSearchFailure(
                customResult,
                createNotification
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

        const [authoredResult, reviewResult] = await Promise.all([
            fetchSearchResults(searchQuery, token, 'Authored PR search'),
            fetchSearchResults(assignedQuery, token, 'Review PR search'),
        ]);

        if (
            authoredResult.status === 'failure' ||
            reviewResult.status === 'failure'
        ) {
            const searchFailures = [authoredResult, reviewResult].filter(
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
                createNotification
            );
            return {
                status: 'failure',
                ...(errorInfo?.rateLimit
                    ? { rateLimit: errorInfo.rateLimit }
                    : {}),
            };
        }

        prItems = [...authoredResult.items, ...reviewResult.items];
    }

    prItems = deduplicateSearchItems(prItems);

    // Canonical PR details are required and validated before optional review
    // and CI requests begin. Supporting failures degrade to "pending".
    const getPRDetails = async (
        item: GitHubIssueSearchItem,
        token: string
    ): Promise<DetailedPullRequestResult> => {
        try {
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
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });

            if (!prResponse.ok) {
                console.error(
                    `Required PR detail request failed with status: ${prResponse.status}`
                );
                const errorInfo = await analyzeHttpError(prResponse);
                return {
                    status: 'failure',
                    response: prResponse,
                    ...(errorInfo.rateLimit
                        ? { rateLimit: errorInfo.rateLimit }
                        : {}),
                };
            }

            const prData: unknown = await prResponse.json();
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
            const [reviewStatus, ciStatus] = await Promise.all([
                getReviewStatus(prUrl, token),
                ciContext
                    ? getCIStatus(ciContext.repoUrl, ciContext.headSha, token)
                    : Promise.resolve<CIStatus>('pending'),
            ]);

            return {
                status: 'success',
                pullRequest: {
                    ...pullRequest,
                    review_status: reviewStatus,
                    ci_status: ciStatus,
                },
            };
        } catch (error) {
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
            failedDetail.response
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
            successfulDetails.map((result) => [
                result.pullRequest.id,
                result.pullRequest,
            ])
        ).values()
    );

    return { status: 'success', pullRequests: uniquePRs };
}
