import browser from 'webextension-polyfill';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createDetailCache,
    DETAIL_CACHE_MAX_AGE_MS,
    DETAIL_CACHE_MAX_ENTRIES,
    DETAIL_CACHE_MAX_BODY_BYTES,
} from '../../src/background/detailCache';
import { fetchPullRequests } from '../../src/background/api';
import type { RefreshSessionContext } from '../../src/background/refreshSession';
import { createDetailCacheCipher } from '../../src/services/secureStorage';
import {
    TOKEN,
    USER,
    createNotificationMock,
    installFetch,
    jsonResponse,
    prDetail,
    prUrl,
    searchItem,
    searchResponse,
} from './api-test-helpers';

const stored = vi.hoisted(() => new Map<string, unknown>());

vi.mock('webextension-polyfill', () => ({
    default: {
        management: { getSelf: vi.fn(async () => ({ id: 'test-extension' })) },
        runtime: { sendMessage: vi.fn(async () => undefined) },
        storage: {
            local: {
                get: vi.fn(async (keys: string | string[]) =>
                    Object.fromEntries(
                        [keys]
                            .flat()
                            .filter((key) => stored.has(key))
                            .map((key) => [key, stored.get(key)])
                    )
                ),
                set: vi.fn(async (values: Record<string, unknown>) => {
                    for (const [key, value] of Object.entries(values))
                        stored.set(key, value);
                }),
                remove: vi.fn(async (keys: string | string[]) => {
                    for (const key of [keys].flat()) stored.delete(key);
                }),
            },
        },
    },
}));

const session = (): RefreshSessionContext => {
    const controller = new AbortController();
    return {
        signal: controller.signal,
        isValid: () => !controller.signal.aborted,
    };
};

const detailResponse = (number: number, etag = '"detail-1"') =>
    jsonResponse(prDetail(number), 200, { etag });

const runRefresh = async (
    cache: Awaited<ReturnType<typeof createDetailCache>>,
    detail: Response,
    reviews: unknown[] = [],
    checkConclusion = 'success'
) => {
    const requested: Array<{ url: string; headers?: HeadersInit }> = [];
    installFetch((url, init) => {
        requested.push({ url, headers: init?.headers });
        if (url.includes('/search/issues'))
            return searchResponse([searchItem(1)]);
        if (url === prUrl(1)) return detail;
        if (url.includes('/reviews?')) return jsonResponse(reviews);
        if (url.includes('/check-runs?'))
            return jsonResponse({
                total_count: 1,
                check_runs: [
                    { id: 1, status: 'completed', conclusion: checkConclusion },
                ],
            });
        throw new Error(`Unexpected request ${url}`);
    });
    const result = await fetchPullRequests(
        TOKEN,
        USER,
        'is:open',
        createNotificationMock(),
        session(),
        cache
    );
    return { result, requested };
};

beforeEach(() => {
    stored.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('encrypted canonical detail cache', () => {
    it('persists one encrypted batch and restores it after a worker restart', async () => {
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        for (let number = 1; number <= 4; number++)
            cache.record(
                prUrl(number),
                detailResponse(number),
                prDetail(number)
            );
        await cache.persist();
        expect(browser.storage.local.set).toHaveBeenCalledTimes(2);
        const encrypted = stored.get('encryptedDetailCache') as string;
        expect(encrypted).not.toContain('PR 1');
        expect(encrypted).not.toContain('acme');
        expect(stored.get('detailCacheIv')).toHaveLength(12);
        const firstIv = stored.get('detailCacheIv');
        const restarted = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        expect(restarted.lookup(prUrl(1))?.etag).toBe('"detail-1"');
        expect(restarted.metrics.encryptedBytes).toBe(encrypted.length);
        restarted.record(prUrl(5), detailResponse(5), prDetail(5));
        await restarted.persist();
        expect(stored.get('detailCacheIv')).not.toEqual(firstIv);
    });

    it('sends an ETag on warm refresh and reuses only the matching validated 304 body', async () => {
        const coldStarted = performance.now();
        const cold = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const initial = await runRefresh(cold, detailResponse(1));
        expect(initial.result.status).toBe('success');
        await cold.persist();
        const coldMs = performance.now() - coldStarted;
        const warmStarted = performance.now();
        const warm = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const result = await runRefresh(
            warm,
            new Response(null, {
                status: 304,
                headers: { 'x-ratelimit-remaining': '123' },
            }),
            [{ user: { id: 3 }, state: 'APPROVED' }],
            'failure'
        );
        expect(result.result.status).toBe('success');
        if (result.result.status === 'success') {
            expect(result.result.pullRequests[0]).toMatchObject({
                title: 'PR 1',
                review_status: 'approved',
                ci_status: 'failing',
            });
        }
        expect(
            result.requested.find((request) => request.url === prUrl(1))
                ?.headers
        ).toMatchObject({ 'If-None-Match': '"detail-1"' });
        expect(result.requested).toHaveLength(4);
        expect(warm.metrics.responses304).toBe(1);
        expect(warm.metrics.bodyBytes).toBe(0);
        expect(warm.metrics.rateRemaining).toBe(123);
        if (process.env.PR_TRACKER_CACHE_MEASURE === '1')
            console.info(
                'DETAIL_CACHE_MOCK_MEASUREMENT',
                JSON.stringify({
                    coldRequests: initial.requested.length,
                    warmRequests: result.requested.length,
                    coldMetrics: cold.metrics,
                    warmMetrics: warm.metrics,
                    coldMs,
                    warmMs: performance.now() - warmStarted,
                })
            );
    });

    it('replaces changed details on 200 and does not cache missing ETags', async () => {
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        cache.record(prUrl(1), detailResponse(1), prDetail(1));
        await cache.persist();
        const changed = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const body = prDetail(1, {
            title: 'Changed',
            draft: true,
            requested_reviewers: [],
        });
        changed.record(
            prUrl(1),
            jsonResponse(body, 200, { etag: '"detail-2"' }),
            body
        );
        await changed.persist();
        const restarted = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        expect(restarted.lookup(prUrl(1))?.detail).toMatchObject({
            title: 'Changed',
            draft: true,
            requested_reviewers: [],
        });
        restarted.record(prUrl(1), jsonResponse(body), body);
        expect(restarted.lookup(prUrl(1))).toBeNull();
    });

    it('persists only validated fields needed for later detail reconstruction', async () => {
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const full = prDetail(1, { body: 'sensitive fixture description' });
        expect(
            (
                await runRefresh(
                    cache,
                    jsonResponse(full, 200, { etag: '"minimal"' })
                )
            ).result.status
        ).toBe('success');
        await cache.persist();
        const restarted = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const detail = restarted.lookup(prUrl(1))?.detail;
        expect(detail).toMatchObject({ id: 1, title: 'PR 1' });
        expect(detail).not.toHaveProperty('body');
        expect(cache.metrics.bodyBytes).toBeGreaterThan(
            JSON.stringify(detail).length
        );
    });

    it('refreshes review dismissal and same-SHA CI despite a detail 304', async () => {
        const cold = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        cold.record(prUrl(1), detailResponse(1), prDetail(1));
        await cold.persist();
        const warm = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const dismissed = await runRefresh(
            warm,
            new Response(null, { status: 304 }),
            [
                { user: { id: 3 }, state: 'APPROVED' },
                { user: { id: 3 }, state: 'DISMISSED' },
            ],
            'failure'
        );
        expect(dismissed.result.status).toBe('success');
        if (dismissed.result.status === 'success')
            expect(dismissed.result.pullRequests[0]).toMatchObject({
                review_status: 'pending',
                ci_status: 'failing',
            });
        expect(
            dismissed.requested.some((request) =>
                request.url.includes('/reviews?')
            )
        ).toBe(true);
        expect(
            dismissed.requested.some((request) =>
                request.url.includes('/check-runs?')
            )
        ).toBe(true);
    });

    it('uses fresh draft and reviewer metadata from a changed 200', async () => {
        const cold = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        cold.record(prUrl(1), detailResponse(1), prDetail(1));
        await cold.persist();
        const warm = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const body = prDetail(1, {
            draft: true,
            requested_reviewers: [
                { login: 'new-reviewer', avatar_url: 'data:,' },
            ],
        });
        const changed = await runRefresh(
            warm,
            jsonResponse(body, 200, { etag: '"detail-2"' })
        );
        expect(changed.result.status).toBe('success');
        if (changed.result.status === 'success')
            expect(changed.result.pullRequests[0]).toMatchObject({
                draft: true,
                requested_reviewers: [{ login: 'new-reviewer' }],
            });
        await warm.persist();
        expect(
            (
                await createDetailCache(
                    'password',
                    TOKEN,
                    USER.login,
                    session()
                )
            ).lookup(prUrl(1))?.etag
        ).toBe('"detail-2"');
    });

    it('does not turn a bare 304 or failed detail into stale success', async () => {
        const empty = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        expect(
            (await runRefresh(empty, new Response(null, { status: 304 })))
                .result.status
        ).toBe('failure');
        empty.record(prUrl(1), detailResponse(1), prDetail(1));
        const failure = await runRefresh(
            empty,
            jsonResponse({ message: 'rate limited' }, 403, {
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 60),
            })
        );
        expect(failure.result.status).toBe('failure');
        expect(failure.result.rateLimit).toBeDefined();
    });

    it('isolates tokens and accounts and discards corrupt or unsupported storage', async () => {
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        cache.record(prUrl(1), detailResponse(1), prDetail(1));
        await cache.persist();
        expect(
            (
                await createDetailCache(
                    'password',
                    'replacement',
                    USER.login,
                    session()
                )
            ).lookup(prUrl(1))
        ).toBeNull();
        expect(
            (
                await createDetailCache(
                    'password',
                    TOKEN,
                    'someone-else',
                    session()
                )
            ).lookup(prUrl(1))
        ).toBeNull();
        stored.set('encryptedDetailCache', 'corrupt');
        expect(
            (
                await createDetailCache(
                    'password',
                    TOKEN,
                    USER.login,
                    session()
                )
            ).lookup(prUrl(1))
        ).toBeNull();
        const cipher = await createDetailCacheCipher('password');
        await cipher.save(
            { version: 2, scope: 'unsupported', entries: [] },
            () => undefined
        );
        expect(
            (
                await createDetailCache(
                    'password',
                    TOKEN,
                    USER.login,
                    session()
                )
            ).lookup(prUrl(1))
        ).toBeNull();
    });

    it('evicts expired and oversized bodies without affecting the live result', async () => {
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const oversized = prDetail(1, {
            body: 'x'.repeat(DETAIL_CACHE_MAX_BODY_BYTES),
        });
        cache.record(
            prUrl(1),
            jsonResponse(oversized, 200, { etag: '"big"' }),
            oversized
        );
        expect(cache.lookup(prUrl(1))).toBeNull();
        const initialTime = Date.now() - 1000;
        const time = vi.spyOn(Date, 'now').mockReturnValue(initialTime);
        for (let number = 2; number <= DETAIL_CACHE_MAX_ENTRIES + 2; number++) {
            time.mockReturnValue(initialTime + number);
            cache.record(
                prUrl(number),
                detailResponse(number),
                prDetail(number)
            );
        }
        time.mockRestore();
        await cache.persist();
        const restarted = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        expect(restarted.metrics.evictions).toBe(0);
        expect(restarted.lookup(prUrl(2))).toBeNull();
        const expiredTime = vi
            .spyOn(Date, 'now')
            .mockReturnValue(initialTime + DETAIL_CACHE_MAX_AGE_MS + 1000);
        expect(restarted.lookup(prUrl(3))).toBeNull();
        const expired = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        expect(expired.lookup(prUrl(3))).toBeNull();
        expiredTime.mockRestore();
    });

    it('bounds aggregate stored detail size independently of entry count', async () => {
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        for (let number = 1; number <= 80; number++) {
            const detail = prDetail(number, { body: 'x'.repeat(20_000) });
            cache.record(prUrl(number), detailResponse(number), detail);
        }
        await cache.persist();
        expect(cache.metrics.evictions).toBeGreaterThan(0);
        const restarted = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        const retained = Array.from({ length: 80 }, (_, index) =>
            restarted.lookup(prUrl(index + 1))
        ).filter(Boolean);
        expect(retained.length).toBeLessThan(80);
        expect(retained.length).toBeGreaterThan(0);
    });

    it('rejects invalidated sessions before persistent writes', async () => {
        const controller = new AbortController();
        const refreshSession = {
            signal: controller.signal,
            isValid: () => !controller.signal.aborted,
        };
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            refreshSession
        );
        cache.record(prUrl(1), detailResponse(1), prDetail(1));
        controller.abort();
        await expect(cache.persist()).rejects.toThrow('invalidated');
        expect(stored.has('encryptedDetailCache')).toBe(false);
    });

    it('treats cache write failure as separate from a successful GitHub result', async () => {
        const cache = await createDetailCache(
            'password',
            TOKEN,
            USER.login,
            session()
        );
        expect((await runRefresh(cache, detailResponse(1))).result.status).toBe(
            'success'
        );
        vi.mocked(browser.storage.local.set).mockRejectedValueOnce(
            new Error('quota')
        );
        await expect(cache.persist()).rejects.toThrow('quota');
        expect(stored.has('encryptedDetailCache')).toBe(false);
    });
});
