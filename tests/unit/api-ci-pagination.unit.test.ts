import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPullRequests } from '../../src/background/api';
import type { RefreshSessionContext } from '../../src/background/refreshSession';
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

vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));
const runs = (count: number) =>
    Array.from({ length: count }, (_, id) => ({
        id,
        status: 'completed',
        conclusion: 'success' as string | null,
    }));
const pageBody = (count: number, page: number) => ({
    total_count: count,
    check_runs: runs(count).slice((page - 1) * 100, page * 100),
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
function scenario(
    check: (page: number, init?: RequestInit) => Response | Promise<Response>,
    combined?: () => Response,
    session?: RefreshSessionContext
) {
    const checkPages: number[] = [];
    const urls: string[] = [];
    const notify = createNotificationMock();
    installFetch((url, init) => {
        urls.push(url);
        if (url.includes('/search/issues?'))
            return searchResponse([searchItem(40)]);
        if (url === prUrl(40)) return jsonResponse(prDetail(40));
        if (url.endsWith('/reviews?per_page=100')) return jsonResponse([]);
        if (url.includes('/check-runs')) {
            const parsed = new URL(url);
            expect(parsed.searchParams.get('per_page')).toBe('100');
            const page = Number(parsed.searchParams.get('page'));
            checkPages.push(page);
            return check(page, init);
        }
        if (url.endsWith('/status') && combined) return combined();
        throw new Error(`Unexpected URL: ${url}`);
    });
    return {
        result: fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            notify,
            session
        ),
        checkPages,
        urls,
        notify,
    };
}
const status = async (result: ReturnType<typeof scenario>['result']) => {
    const value = await result;
    expect(value.status).toBe('success');
    if (value.status !== 'success')
        throw new Error('Expected complete PR discovery');
    return { ci: value.pullRequests[0].ci_status, rateLimit: value.rateLimit };
};

describe('CI check-run pagination', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([30, 31, 45, 100, 101, 145, 200, 205, 999, 1000])(
        'collects %i runs without an extra terminal request',
        async (count) => {
            const test = scenario((page) =>
                jsonResponse(pageBody(count, page))
            );
            expect((await status(test.result)).ci).toBe('passing');
            expect(test.checkPages).toEqual(
                Array.from(
                    { length: Math.ceil(count / 100) },
                    (_, index) => index + 1
                )
            );
            expect(test.urls.some((url) => url.endsWith('/status'))).toBe(
                false
            );
        }
    );
    it.each([
        { status: 'completed', conclusion: 'failure', expected: 'failing' },
        { status: 'completed', conclusion: 'timed_out', expected: 'failing' },
        { status: 'queued', conclusion: null, expected: 'pending' },
        { status: 'in_progress', conclusion: null, expected: 'pending' },
        { status: 'completed', conclusion: 'cancelled', expected: 'pending' },
    ])(
        'includes later-page $conclusion/$status in reduction',
        async ({ status: runStatus, conclusion, expected }) => {
            const test = scenario((page) => {
                const body = pageBody(101, page);
                if (page === 2)
                    Object.assign(body.check_runs[0], {
                        status: runStatus,
                        conclusion,
                    });
                return jsonResponse(body);
            });
            expect((await status(test.result)).ci).toBe(expected);
            expect(test.checkPages).toEqual([1, 2]);
        }
    );
    it.each(['success', 'failure', null])(
        'does not short-circuit an incomplete first page (%s)',
        async (conclusion) => {
            const test = scenario((page) => {
                if (page === 2) return jsonResponse({}, 502);
                const body = pageBody(101, page);
                Object.assign(body.check_runs[0], {
                    status: conclusion === null ? 'queued' : 'completed',
                    conclusion,
                });
                return jsonResponse(body);
            });
            expect(await status(test.result)).toEqual({
                ci: 'unknown',
                rateLimit: undefined,
            });
            expect(test.checkPages).toEqual([1, 2]);
            expect(test.notify).not.toHaveBeenCalled();
        }
    );
    it.each([
        {},
        { check_runs: [] },
        { total_count: -1, check_runs: [] },
        { total_count: 101, check_runs: [] },
        { total_count: 102, check_runs: runs(2) },
        { total_count: 101, check_runs: [null] },
        { total_count: 101, check_runs: [{ id: 100, status: 'completed' }] },
        {
            total_count: 101,
            check_runs: [{ status: 'completed', conclusion: 'success' }],
        },
        {
            total_count: 101,
            check_runs: [{ id: 0, status: 'completed', conclusion: 'success' }],
        },
        { total_count: 101, check_runs: runs(2) },
    ])(
        'returns unknown for a malformed, drifting, duplicate or short subsequent page %j',
        async (body) => {
            const test = scenario((page) =>
                jsonResponse(page === 1 ? pageBody(101, page) : body)
            );
            expect((await status(test.result)).ci).toBe('unknown');
            expect(test.checkPages).toEqual([1, 2]);
        }
    );
    it.each(['network', 'json'])(
        'returns unknown after later-page %s failure',
        async (failure) => {
            const test = scenario((page) => {
                if (page === 1) return jsonResponse(pageBody(101, page));
                if (failure === 'network')
                    throw new TypeError('Network failed');
                return new Response('{bad JSON');
            });
            expect((await status(test.result)).ci).toBe('unknown');
            expect(test.checkPages).toEqual([1, 2]);
        }
    );
    it.each([1001, 100000])(
        'bounds work for %i advertised runs',
        async (count) => {
            const test = scenario((page) =>
                jsonResponse(pageBody(count, page))
            );
            expect((await status(test.result)).ci).toBe('unknown');
            expect(test.checkPages).toEqual([1]);
        }
    );
    it('rejects a first page truncated to the old 30-item default despite per_page=100', async () => {
        const test = scenario(() =>
            jsonResponse({ total_count: 45, check_runs: runs(30) })
        );
        expect((await status(test.result)).ci).toBe('unknown');
        expect(test.checkPages).toEqual([1]);
    });
    it('rejects contradictory next-page metadata rather than claiming completeness', async () => {
        const test = scenario(() =>
            jsonResponse(pageBody(30, 1), 200, {
                link: '<https://api.github.com/next>; rel="next"',
            })
        );
        expect((await status(test.result)).ci).toBe('unknown');
        expect(test.checkPages).toEqual([1]);
    });
    it.each(['primary', 'secondary'] as const)(
        'retains a later-page %s cooldown and stops pagination',
        async (kind) => {
            vi.useFakeTimers();
            vi.setSystemTime('2030-06-07T08:09:10Z');
            const headers =
                kind === 'primary'
                    ? {
                          'x-ratelimit-remaining': '0',
                          'x-ratelimit-reset': String(Date.now() / 1000 + 60),
                      }
                    : { 'retry-after': '60' };
            const test = scenario((page) =>
                page === 1
                    ? jsonResponse(pageBody(205, page))
                    : jsonResponse(
                          {
                              message:
                                  kind === 'primary'
                                      ? 'API rate limit exceeded'
                                      : 'secondary rate limit',
                          },
                          kind === 'primary' ? 403 : 429,
                          headers
                      )
            );
            const value = await status(test.result);
            expect(value.ci).toBe('unknown');
            expect(value.rateLimit).toMatchObject({
                classification: kind,
                nextAllowedAt: Date.now() + 60000,
            });
            expect(test.checkPages).toEqual([1, 2]);
        }
    );
    it.each(['abort', 'generation', 'json'] as const)(
        'stops at a paused page boundary on %s invalidation',
        async (boundary) => {
            const gate = deferred<Response>();
            const reached = deferred<void>();
            const controller = new AbortController();
            let valid = true;
            const test = scenario(
                (page, init) => {
                    expect(init?.signal).toBe(controller.signal);
                    if (boundary === 'json') {
                        const response = jsonResponse(pageBody(205, 1));
                        vi.spyOn(response, 'json').mockImplementation(
                            async () => {
                                reached.resolve();
                                await gate.promise;
                                return pageBody(205, 1);
                            }
                        );
                        return response;
                    }
                    if (page === 1) return jsonResponse(pageBody(205, page));
                    reached.resolve();
                    return gate.promise;
                },
                undefined,
                { signal: controller.signal, isValid: () => valid }
            );
            await reached.promise;
            const rejected = expect(test.result).rejects.toMatchObject({
                name: 'RefreshSessionInvalidatedError',
            });
            if (boundary === 'abort') controller.abort();
            else valid = false;
            gate.resolve(jsonResponse(pageBody(205, 2)));
            await rejected;
            expect(test.checkPages).toEqual(boundary === 'json' ? [1] : [1, 2]);
            expect(test.notify).not.toHaveBeenCalled();
        }
    );
});

describe('combined commit-status aggregate', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
    it.each([
        { state: 'success', expected: 'passing' },
        { state: 'failure', expected: 'failing' },
        { state: 'pending', expected: 'pending' },
    ])(
        'uses authoritative $state across 145 contexts without enumerating status pages',
        async ({ state, expected }) => {
            // First-page success contexts alone cannot explain a pending/failing aggregate.
            const test = scenario(
                () => jsonResponse(pageBody(0, 1)),
                () =>
                    jsonResponse(
                        {
                            state,
                            total_count: 145,
                            statuses: Array.from({ length: 30 }, () => ({
                                state: 'success',
                            })),
                        },
                        200,
                        {
                            link: '<https://api.github.com/status?page=2>; rel="next"',
                        }
                    )
            );
            expect((await status(test.result)).ci).toBe(expected);
            expect(test.checkPages).toEqual([1]);
            expect(
                test.urls.filter((url) => url.endsWith('/status'))
            ).toHaveLength(1);
            expect(test.urls).toHaveLength(5);
        }
    );
    it('confirms No CI from two empty collections without follow-up pages', async () => {
        const test = scenario(
            () => jsonResponse(pageBody(0, 1)),
            () =>
                jsonResponse({ state: 'pending', total_count: 0, statuses: [] })
        );
        expect((await status(test.result)).ci).toBe('no-ci');
        expect(test.urls).toHaveLength(5);
    });
    it.each([
        { state: 'success', statuses: [{ state: 'success' }] },
        { state: 'pending', total_count: 45, statuses: [] },
        { total_count: 45, statuses: runs(30) },
        { state: 'pending', total_count: 0, statuses: [{ state: 'pending' }] },
    ])('rejects an unusable aggregate %j', async (body) => {
        const test = scenario(
            () => jsonResponse(pageBody(0, 1)),
            () => jsonResponse(body)
        );
        expect((await status(test.result)).ci).toBe('unknown');
    });
});
