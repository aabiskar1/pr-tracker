import browser from 'webextension-polyfill';
import {
    GitHubIssueSearchItem,
    GitHubReview,
    GitHubChecksResponse,
    PullRequest,
} from '../types';

// Constants
const NOTIFICATION_ICON = 'icons/icon-128.png';

// Error handling
export async function analyzeHttpError(
    response: Response
): Promise<{ message: string; isRateLimit: boolean; isAuth: boolean }> {
    const status = response.status;
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    const rateLimitReset = response.headers.get('X-RateLimit-Reset');
    let body = '';
    try {
        body = await response.clone().text();
    } catch {
        /* ignore */
    }
    const lowerBody = body.toLowerCase();

    const isRateLimit =
        (status === 403 && rateLimitRemaining === '0') ||
        status === 429 ||
        lowerBody.includes('secondary rate limit') ||
        lowerBody.includes('abuse detection') ||
        lowerBody.includes('rate limit');
    if (isRateLimit) {
        const resetTime = rateLimitReset
            ? new Date(parseInt(rateLimitReset) * 1000)
            : null;
        const resetTimeStr = resetTime
            ? ` (resets at ${resetTime.toLocaleTimeString()})`
            : '';
        return {
            message: `GitHub API rate limit exceeded${resetTimeStr}. Please wait before trying again.`,
            isRateLimit: true,
            isAuth: false,
        };
    }

    if (status === 401) {
        return {
            message:
                'Authentication failed (401). Your GitHub token may have been revoked or expired. Re-enter password or reset to provide a new token.',
            isRateLimit: false,
            isAuth: true,
        };
    }

    if (status === 403) {
        return {
            message:
                'Access forbidden (403). Could be missing repo scope OR a temporary GitHub restriction. Try again later; if persistent, regenerate a token with repo scope.',
            isRateLimit: false,
            isAuth: false,
        };
    }

    if (status >= 500) {
        return {
            message: `GitHub servers are experiencing issues (${status}). Please try again later.`,
            isRateLimit: false,
            isAuth: false,
        };
    }

    if (status >= 400) {
        return {
            message: `Request failed with status ${status}. Please check your network connection and try again.`,
            isRateLimit: false,
            isAuth: false,
        };
    }

    return {
        message: `Unexpected error occurred (${status}). Please try again.`,
        isRateLimit: false,
        isAuth: false,
    };
}

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
): Promise<{ message: string; isRateLimit: boolean; isAuth: boolean }> {
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
): Promise<'approved' | 'changes-requested' | 'pending'> {
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
    prUrl: string,
    token: string
): Promise<'passing' | 'failing' | 'pending'> {
    try {
        // First get the PR to find the head SHA
        const prResponse = await fetch(prUrl, {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        if (!prResponse.ok) return 'pending';

        const prData = await prResponse.json();
        const sha = prData.head.sha;
        const repoUrl = prData.base.repo.url;

        // Check runs
        const checksUrl = `${repoUrl}/commits/${sha}/check-runs`;
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
            const statusUrl = `${repoUrl}/commits/${sha}/status`;
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
): Promise<PullRequest[]> {
    let prItems: GitHubIssueSearchItem[] = [];

    if (customQuery && customQuery.trim()) {
        const customResp = await fetch(
            `https://api.github.com/search/issues?q=${encodeURIComponent(customQuery)}&per_page=100`,
            {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            }
        );
        if (!customResp.ok) {
            await handleApiError(
                customResp,
                createNotification,
                'Custom PR search'
            );
            return [];
        }
        const customData = await customResp.json();
        prItems = customData.items || [];
    } else {
        const searchQuery = `is:open is:pr author:${user.login} archived:false`;
        const assignedQuery = `is:open is:pr review-requested:${user.login} archived:false`;

        const [authoredResponse, reviewResponse] = await Promise.all([
            fetch(
                `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
                {
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github.v3+json',
                    },
                }
            ),
            fetch(
                `https://api.github.com/search/issues?q=${encodeURIComponent(assignedQuery)}&per_page=100`,
                {
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github.v3+json',
                    },
                }
            ),
        ]);

        if (!authoredResponse.ok || !reviewResponse.ok) {
            const failedResponse = !authoredResponse.ok
                ? authoredResponse
                : reviewResponse;
            const context = !authoredResponse.ok
                ? 'Authored PR search'
                : 'Review PR search';
            await handleApiError(failedResponse, createNotification, context);
            return [];
        }

        const authoredData = await authoredResponse.json();
        const reviewData = await reviewResponse.json();
        prItems = [...(authoredData.items || []), ...(reviewData.items || [])];
    }

    // Get full PR details
    const getPRDetails = async (item: GitHubIssueSearchItem, token: string) => {
        try {
            if (
                !item.pull_request ||
                typeof item.pull_request !== 'object' ||
                !('url' in item.pull_request)
            ) {
                console.error('Item missing pull_request URL');
                return null;
            }

            const prUrl = item.pull_request.url as string;

            const [prData, reviewStatus, ciStatus] = await Promise.all([
                fetch(prUrl, {
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github.v3+json',
                    },
                }).then((r) => r.json()),
                getReviewStatus(prUrl, token),
                getCIStatus(prUrl, token),
            ]);

            return {
                ...prData,
                review_status: reviewStatus,
                ci_status: ciStatus,
            };
        } catch (error) {
            console.error('Error fetching PR details:', error);
            return null;
        }
    };

    console.log('Fetching detailed PR information...');
    const detailedPRs = (
        await Promise.all(
            prItems.map((item: GitHubIssueSearchItem) =>
                getPRDetails(item, token)
            )
        )
    ).filter(Boolean);

    // Combine and deduplicate PRs
    const allPRs = detailedPRs;

    // Map each PR to our simplified format
    const uniquePRs = Array.from(
        new Map(
            allPRs
                .map((pr) => {
                    try {
                        const repoName =
                            pr.base && pr.base.repo && pr.base.repo.name
                                ? pr.base.repo.name
                                : pr.repository && pr.repository.name
                                  ? pr.repository.name
                                  : pr.html_url.split('/')[4];

                        return [
                            pr.id,
                            {
                                id: pr.id,
                                title: pr.title || 'Untitled PR',
                                html_url: pr.html_url,
                                repository: {
                                    name: repoName,
                                },
                                state: pr.state || 'open',
                                draft: pr.draft || false,
                                created_at:
                                    pr.created_at || new Date().toISOString(),
                                requested_reviewers:
                                    pr.requested_reviewers || [],
                                review_status: pr.review_status,
                                ci_status: pr.ci_status,
                                author: pr.user
                                    ? {
                                          login: pr.user.login,
                                          avatar_url: pr.user.avatar_url,
                                      }
                                    : undefined,
                            },
                        ];
                    } catch (err) {
                        console.error('Error processing PR:', err);
                        return null;
                    }
                })
                .filter(Boolean) as [number, PullRequest][]
        ).values()
    );

    return uniquePRs;
}
