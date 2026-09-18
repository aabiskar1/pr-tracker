import browser from 'webextension-polyfill';
import type { GitHubRateLimitCooldown } from '../utils/githubRateLimit';

export {
    deriveGitHubRateLimitCooldown,
    formatGitHubCooldownTime,
    selectLatestGitHubRateLimitCooldown,
} from '../utils/githubRateLimit';
export type {
    GitHubRateLimitClassification,
    GitHubRateLimitCooldown,
    GitHubRateLimitDeadlineSource,
} from '../utils/githubRateLimit';

export const GITHUB_RATE_LIMIT_COOLDOWN_KEY =
    'prtracker_github_rate_limit_cooldown';

const isCooldown = (value: unknown): value is GitHubRateLimitCooldown => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return (
        (candidate.classification === 'primary' ||
            candidate.classification === 'secondary' ||
            candidate.classification === 'generic') &&
        typeof candidate.nextAllowedAt === 'number' &&
        Number.isFinite(candidate.nextAllowedAt) &&
        candidate.nextAllowedAt > 0 &&
        (candidate.deadlineSource === 'retry-after' ||
            candidate.deadlineSource === 'reset' ||
            candidate.deadlineSource === 'secondary-fallback') &&
        (typeof candidate.resource === 'undefined' ||
            (typeof candidate.resource === 'string' &&
                candidate.resource.length > 0))
    );
};

export async function loadGitHubRateLimitCooldown(): Promise<GitHubRateLimitCooldown | null> {
    const stored = await browser.storage.local.get(
        GITHUB_RATE_LIMIT_COOLDOWN_KEY
    );
    const value = stored[GITHUB_RATE_LIMIT_COOLDOWN_KEY];
    return isCooldown(value) ? value : null;
}

export async function persistGitHubRateLimitCooldown(
    cooldown: GitHubRateLimitCooldown
): Promise<void> {
    await browser.storage.local.set({
        [GITHUB_RATE_LIMIT_COOLDOWN_KEY]: cooldown,
    });
}

export async function clearGitHubRateLimitCooldown(): Promise<void> {
    await browser.storage.local.remove(GITHUB_RATE_LIMIT_COOLDOWN_KEY);
}

export async function getActiveGitHubRateLimitCooldown(
    now = Date.now()
): Promise<GitHubRateLimitCooldown | null> {
    const cooldown = await loadGitHubRateLimitCooldown();
    if (!cooldown) return null;
    if (now < cooldown.nextAllowedAt) return cooldown;
    await clearGitHubRateLimitCooldown();
    return null;
}
