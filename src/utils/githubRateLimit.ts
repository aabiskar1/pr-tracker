export type GitHubRateLimitClassification = 'primary' | 'secondary' | 'generic';

export type GitHubRateLimitDeadlineSource =
    | 'retry-after'
    | 'reset'
    | 'secondary-fallback';

export type GitHubRateLimitCooldown = {
    classification: GitHubRateLimitClassification;
    nextAllowedAt: number;
    deadlineSource: GitHubRateLimitDeadlineSource;
    resource?: string;
};

const SECONDARY_FALLBACK_MS = 60 * 1000;
const MAX_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

const isSensibleFutureTimestamp = (value: number, now: number): boolean =>
    Number.isFinite(value) && value > now && value <= now + MAX_COOLDOWN_MS;

const parseRetryAfter = (value: string | null, now: number): number | null => {
    if (!value) return null;

    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
        const seconds = Number(trimmed);
        const timestamp = now + seconds * 1000;
        return isSensibleFutureTimestamp(timestamp, now) ? timestamp : null;
    }

    const timestamp = Date.parse(trimmed);
    return isSensibleFutureTimestamp(timestamp, now) ? timestamp : null;
};

const parseReset = (value: string | null, now: number): number | null => {
    if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const timestamp = Number(value) * 1000;
    return isSensibleFutureTimestamp(timestamp, now) ? timestamp : null;
};

export function deriveGitHubRateLimitCooldown(
    response: Response,
    responseBody: string,
    now = Date.now()
): GitHubRateLimitCooldown | null {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const lowerBody = responseBody.toLowerCase();
    const isSecondary =
        lowerBody.includes('secondary rate limit') ||
        lowerBody.includes('abuse detection');
    const isExhausted = remaining === '0';
    const isClearlyRateLimited =
        response.status === 429 ||
        lowerBody.includes('rate limit') ||
        isSecondary;

    let classification: GitHubRateLimitClassification;
    if (isSecondary) {
        classification = 'secondary';
    } else if (
        isExhausted &&
        (response.status === 403 || response.status === 429)
    ) {
        classification = 'primary';
    } else if (isClearlyRateLimited) {
        classification = 'generic';
    } else {
        return null;
    }

    const retryAfter = parseRetryAfter(
        response.headers.get('retry-after'),
        now
    );
    const reset = isExhausted
        ? parseReset(response.headers.get('x-ratelimit-reset'), now)
        : null;
    const fallback =
        classification === 'secondary' || classification === 'generic'
            ? now + SECONDARY_FALLBACK_MS
            : null;
    const nextAllowedAt = retryAfter ?? reset ?? fallback;
    if (!nextAllowedAt) return null;

    const resource = response.headers.get('x-ratelimit-resource')?.trim();

    return {
        classification,
        nextAllowedAt,
        deadlineSource: retryAfter
            ? 'retry-after'
            : reset
              ? 'reset'
              : 'secondary-fallback',
        ...(resource ? { resource } : {}),
    };
}

export const formatGitHubCooldownTime = (nextAllowedAt: number): string =>
    new Date(nextAllowedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
