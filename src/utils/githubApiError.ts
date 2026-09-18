import {
    deriveGitHubRateLimitCooldown,
    formatGitHubCooldownTime,
    type GitHubRateLimitCooldown,
} from './githubRateLimit';

export type GitHubApiErrorInfo = {
    message: string;
    isRateLimit: boolean;
    isAuth: boolean;
    rateLimit?: GitHubRateLimitCooldown;
};

export async function analyzeGitHubHttpError(
    response: Response
): Promise<GitHubApiErrorInfo> {
    const status = response.status;
    let body = '';
    try {
        body = await response.clone().text();
    } catch {
        /* ignore */
    }
    const rateLimit = deriveGitHubRateLimitCooldown(response, body);
    if (rateLimit) {
        const resetTime = formatGitHubCooldownTime(rateLimit.nextAllowedAt);
        return {
            message: `GitHub API rate limit exceeded (resets at ${resetTime}). Please wait before trying again.`,
            isRateLimit: true,
            isAuth: false,
            rateLimit,
        };
    }

    const lowerBody = body.toLowerCase();
    const isRecognizedWithoutDeadline =
        (status === 403 &&
            response.headers.get('x-ratelimit-remaining') === '0') ||
        status === 429 ||
        lowerBody.includes('secondary rate limit') ||
        lowerBody.includes('abuse detection') ||
        lowerBody.includes('rate limit');
    if (isRecognizedWithoutDeadline) {
        return {
            message:
                'GitHub API rate limit exceeded. Please wait before trying again.',
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
