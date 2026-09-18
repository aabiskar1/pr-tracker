import browser from 'webextension-polyfill';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GITHUB_RATE_LIMIT_COOLDOWN_KEY,
    clearGitHubRateLimitCooldown,
    deriveGitHubRateLimitCooldown,
    getActiveGitHubRateLimitCooldown,
    loadGitHubRateLimitCooldown,
    persistGitHubRateLimitCooldown,
    type GitHubRateLimitCooldown,
} from '../../src/background/githubRateLimit';

const storage = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));

vi.mock('webextension-polyfill', () => ({
    default: {
        storage: {
            local: {
                get: vi.fn(async (key: string) => ({
                    [key]: storage.values[key],
                })),
                set: vi.fn(async (values: Record<string, unknown>) => {
                    Object.assign(storage.values, values);
                }),
                remove: vi.fn(async (key: string) => {
                    delete storage.values[key];
                }),
            },
        },
    },
}));

const NOW = new Date('2030-06-07T08:09:10.000Z').getTime();
const RESET = NOW + 5 * 60_000;

const response = (status: number, headers: HeadersInit = {}): Response =>
    new Response('', { status, headers });

describe('GitHub rate-limit metadata', () => {
    it.each([403, 429])(
        'classifies an exhausted %s response as primary',
        (status) => {
            const cooldown = deriveGitHubRateLimitCooldown(
                response(status, {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': String(RESET / 1000),
                    'x-ratelimit-resource': 'core',
                }),
                '',
                NOW
            );

            expect(cooldown).toEqual({
                classification: 'primary',
                nextAllowedAt: RESET,
                deadlineSource: 'reset',
                resource: 'core',
            });
        }
    );

    it('uses Retry-After ahead of reset for a secondary rate limit', () => {
        const cooldown = deriveGitHubRateLimitCooldown(
            response(403, {
                'retry-after': '120',
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': String(RESET / 1000),
                'x-ratelimit-resource': 'search',
            }),
            'You have exceeded a secondary rate limit.',
            NOW
        );

        expect(cooldown).toEqual({
            classification: 'secondary',
            nextAllowedAt: NOW + 120_000,
            deadlineSource: 'retry-after',
            resource: 'search',
        });
    });

    it('accepts an HTTP-date Retry-After value', () => {
        const deadline = NOW + 90_000;
        const cooldown = deriveGitHubRateLimitCooldown(
            response(429, {
                'retry-after': new Date(deadline).toUTCString(),
            }),
            '',
            NOW
        );

        expect(cooldown?.nextAllowedAt).toBe(deadline);
        expect(cooldown?.deadlineSource).toBe('retry-after');
    });

    it('uses a one-minute fallback for a recognized secondary limit', () => {
        const cooldown = deriveGitHubRateLimitCooldown(
            response(403),
            'Request blocked by abuse detection mechanism.',
            NOW
        );

        expect(cooldown).toEqual({
            classification: 'secondary',
            nextAllowedAt: NOW + 60_000,
            deadlineSource: 'secondary-fallback',
        });
    });

    it('ignores malformed headers and uses the next valid fallback', () => {
        expect(() =>
            deriveGitHubRateLimitCooldown(
                response(403, {
                    'retry-after': 'not-a-delay',
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': '-1',
                }),
                'secondary rate limit',
                NOW
            )
        ).not.toThrow();

        expect(
            deriveGitHubRateLimitCooldown(
                response(403, {
                    'retry-after': 'not-a-delay',
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': '-1',
                }),
                'secondary rate limit',
                NOW
            )
        ).toMatchObject({
            nextAllowedAt: NOW + 60_000,
            deadlineSource: 'secondary-fallback',
        });
    });

    it.each([401, 403, 404, 500])(
        'does not create a cooldown for an ordinary %s response',
        (status) => {
            expect(
                deriveGitHubRateLimitCooldown(
                    response(status, {
                        'x-ratelimit-remaining': '12',
                    }),
                    'ordinary failure',
                    NOW
                )
            ).toBeNull();
        }
    );
});

describe('persisted GitHub cooldown', () => {
    const cooldown: GitHubRateLimitCooldown = {
        classification: 'primary',
        nextAllowedAt: RESET,
        deadlineSource: 'reset',
        resource: 'core',
    };

    beforeEach(() => {
        storage.values = {};
        vi.clearAllMocks();
    });

    it('persists separately under the dedicated storage key', async () => {
        await persistGitHubRateLimitCooldown(cooldown);

        expect(browser.storage.local.set).toHaveBeenCalledWith({
            [GITHUB_RATE_LIMIT_COOLDOWN_KEY]: cooldown,
        });
        await expect(loadGitHubRateLimitCooldown()).resolves.toEqual(cooldown);
    });

    it('survives module recreation because browser storage is authoritative', async () => {
        await persistGitHubRateLimitCooldown(cooldown);
        vi.resetModules();

        const reloaded = await import('../../src/background/githubRateLimit');

        await expect(
            reloaded.getActiveGitHubRateLimitCooldown(NOW)
        ).resolves.toEqual(cooldown);
    });

    it('returns an active cooldown without changing storage', async () => {
        await persistGitHubRateLimitCooldown(cooldown);

        await expect(getActiveGitHubRateLimitCooldown(NOW)).resolves.toEqual(
            cooldown
        );
        expect(browser.storage.local.remove).not.toHaveBeenCalled();
    });

    it('clears an expired cooldown and allows work to continue', async () => {
        await persistGitHubRateLimitCooldown(cooldown);

        await expect(
            getActiveGitHubRateLimitCooldown(RESET)
        ).resolves.toBeNull();
        expect(browser.storage.local.remove).toHaveBeenCalledWith(
            GITHUB_RATE_LIMIT_COOLDOWN_KEY
        );
    });

    it('can be cleared after a successful recovery', async () => {
        await persistGitHubRateLimitCooldown(cooldown);
        await clearGitHubRateLimitCooldown();

        await expect(loadGitHubRateLimitCooldown()).resolves.toBeNull();
    });
});
