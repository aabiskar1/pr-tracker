import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchPullRequests,
    PR_DETAIL_CONCURRENCY,
} from '../../src/background/api';
import {
    TOKEN,
    USER,
    createNotificationMock,
    installFetch,
    jsonResponse,
    prDetail,
    searchItem,
    searchResponse,
} from './api-test-helpers';

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

const deferred = <T = void>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const prNumberFromUrl = (url: string): number => {
    const match = url.match(/pulls\/(\d+)/);
    if (!match) throw new Error(`Unexpected PR URL: ${url}`);
    return Number(match[1]);
};

const successfulChecks = () =>
    jsonResponse({
        check_runs: [{ status: 'completed', conclusion: 'success' }],
    });

describe('fetchPullRequests per-PR concurrency', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('bounds active PR work, waits for full worker capacity, and preserves result order', async () => {
        const itemCount = PR_DETAIL_CONCURRENCY * 5;
        const detailGates = Array.from({ length: itemCount }, () => deferred());
        const firstBatchStarted = deferred();
        const firstSupportingRequestsStarted = deferred();
        const releaseFirstSupportingRequests = deferred();
        const fifthDetailStarted = deferred();
        const startedDetails: number[] = [];
        let firstSupportingRequestCount = 0;
        let activeWorkers = 0;
        let maxActiveWorkers = 0;

        installFetch(async (url) => {
            if (url.startsWith('https://api.github.com/search/issues?')) {
                return searchResponse(
                    Array.from({ length: itemCount }, (_, index) =>
                        searchItem(index + 1)
                    )
                );
            }

            if (/\/pulls\/\d+$/.test(url)) {
                const number = prNumberFromUrl(url);
                startedDetails.push(number);
                activeWorkers += 1;
                maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
                if (startedDetails.length === PR_DETAIL_CONCURRENCY) {
                    firstBatchStarted.resolve();
                }
                if (number === PR_DETAIL_CONCURRENCY + 1) {
                    fifthDetailStarted.resolve();
                }
                await detailGates[number - 1].promise;
                return jsonResponse(prDetail(number));
            }

            const number = Number(url.match(/repo-(\d+)/)?.[1]);
            if (!number) throw new Error(`Unexpected supporting URL: ${url}`);
            if (number === 1) {
                firstSupportingRequestCount += 1;
                if (firstSupportingRequestCount === 2) {
                    firstSupportingRequestsStarted.resolve();
                }
                await releaseFirstSupportingRequests.promise;
            }
            if (url.endsWith('/reviews')) return jsonResponse([]);
            if (url.includes('/check-runs')) {
                activeWorkers -= 1;
                return successfulChecks();
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const resultPromise = fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );

        await firstBatchStarted.promise;
        expect(startedDetails).toEqual([1, 2, 3, 4]);
        expect(maxActiveWorkers).toBe(PR_DETAIL_CONCURRENCY);

        detailGates[0].resolve();
        await firstSupportingRequestsStarted.promise;
        expect(startedDetails).toEqual([1, 2, 3, 4]);

        releaseFirstSupportingRequests.resolve();
        await fifthDetailStarted.promise;
        expect(startedDetails).toEqual([1, 2, 3, 4, 5]);

        detailGates.forEach((gate) => gate.resolve());
        const result = await resultPromise;

        expect(result.status).toBe('success');
        if (result.status === 'success') {
            expect(
                result.pullRequests.map((pullRequest) => pullRequest.id)
            ).toEqual(
                Array.from({ length: itemCount }, (_, index) => index + 1)
            );
        }
        expect(startedDetails).toEqual(
            Array.from({ length: itemCount }, (_, index) => index + 1)
        );
        expect(maxActiveWorkers).toBe(PR_DETAIL_CONCURRENCY);
    });

    it('returns complete failure while continuing bounded work after an ordinary required failure', async () => {
        const itemCount = PR_DETAIL_CONCURRENCY + 2;
        const requestedDetails: number[] = [];

        installFetch((url) => {
            if (url.startsWith('https://api.github.com/search/issues?')) {
                return searchResponse(
                    Array.from({ length: itemCount }, (_, index) =>
                        searchItem(index + 1)
                    )
                );
            }
            if (/\/pulls\/\d+$/.test(url)) {
                const number = prNumberFromUrl(url);
                requestedDetails.push(number);
                return number === 2
                    ? jsonResponse({ message: 'Service unavailable' }, 503)
                    : jsonResponse(prDetail(number));
            }
            if (url.endsWith('/reviews')) return jsonResponse([]);
            if (url.includes('/check-runs')) return successfulChecks();
            throw new Error(`Unexpected URL: ${url}`);
        });

        await expect(
            fetchPullRequests(
                TOKEN,
                USER,
                'is:pr org:acme',
                createNotificationMock()
            )
        ).resolves.toEqual({ status: 'failure' });
        expect(requestedDetails).toEqual(
            Array.from({ length: itemCount }, (_, index) => index + 1)
        );
    });

    it('prefers rate-limit metadata, stops queued work, settles active workers, and recovers', async () => {
        const now = new Date('2030-06-07T08:09:10.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const itemCount = PR_DETAIL_CONCURRENCY + 4;
        const detailGates = Array.from({ length: itemCount }, () => deferred());
        const firstBatchStarted = deferred();
        const fifthDetailStarted = deferred();
        const requestedDetails: number[] = [];
        let recovery = false;

        installFetch(async (url) => {
            if (url.startsWith('https://api.github.com/search/issues?')) {
                return searchResponse(
                    recovery
                        ? [searchItem(99)]
                        : Array.from({ length: itemCount }, (_, index) =>
                              searchItem(index + 1)
                          )
                );
            }
            if (/\/pulls\/\d+$/.test(url)) {
                const number = prNumberFromUrl(url);
                requestedDetails.push(number);
                if (recovery) return jsonResponse(prDetail(number));
                if (requestedDetails.length === PR_DETAIL_CONCURRENCY) {
                    firstBatchStarted.resolve();
                }
                if (number === PR_DETAIL_CONCURRENCY + 1) {
                    fifthDetailStarted.resolve();
                }
                await detailGates[number - 1].promise;
                if (number === 1) {
                    return jsonResponse({ message: 'Server failure' }, 500);
                }
                if (number === 2) {
                    return jsonResponse(
                        {
                            message:
                                'You have exceeded a secondary rate limit.',
                        },
                        429,
                        {
                            'retry-after': '90',
                            'x-ratelimit-resource': 'core',
                        }
                    );
                }
                return jsonResponse(prDetail(number));
            }
            if (url.endsWith('/reviews')) return jsonResponse([]);
            if (url.includes('/check-runs')) return successfulChecks();
            throw new Error(`Unexpected URL: ${url}`);
        });

        const failedResult = fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );
        await firstBatchStarted.promise;

        detailGates[0].resolve();
        await fifthDetailStarted.promise;
        detailGates[1].resolve();
        detailGates[2].resolve();
        detailGates[3].resolve();
        detailGates[4].resolve();

        await expect(failedResult).resolves.toEqual({
            status: 'failure',
            rateLimit: {
                classification: 'secondary',
                nextAllowedAt: now.getTime() + 90_000,
                deadlineSource: 'retry-after',
                resource: 'core',
            },
        });
        expect(requestedDetails).toEqual([1, 2, 3, 4, 5]);

        recovery = true;
        await expect(
            fetchPullRequests(
                TOKEN,
                USER,
                'is:pr org:acme',
                createNotificationMock()
            )
        ).resolves.toMatchObject({
            status: 'success',
            pullRequests: [{ id: 99 }],
        });
        expect(requestedDetails.at(-1)).toBe(99);
    });

    it('continues the pool when optional requests fail and degrades them to pending', async () => {
        const itemCount = PR_DETAIL_CONCURRENCY + 2;

        installFetch((url) => {
            if (url.startsWith('https://api.github.com/search/issues?')) {
                return searchResponse(
                    Array.from({ length: itemCount }, (_, index) =>
                        searchItem(index + 1)
                    )
                );
            }
            if (/\/pulls\/\d+$/.test(url)) {
                return jsonResponse(prDetail(prNumberFromUrl(url)));
            }
            if (url.endsWith('/reviews')) {
                return jsonResponse({ message: 'Service unavailable' }, 503);
            }
            if (url.includes('/check-runs')) {
                return jsonResponse({ message: 'Service unavailable' }, 503);
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );

        expect(result.status).toBe('success');
        if (result.status === 'success') {
            expect(result.pullRequests).toHaveLength(itemCount);
            expect(
                result.pullRequests.every(
                    (pullRequest) =>
                        pullRequest.review_status === 'pending' &&
                        pullRequest.ci_status === 'pending'
                )
            ).toBe(true);
        }
    });

    it('does not start queued PR units after session invalidation', async () => {
        const itemCount = PR_DETAIL_CONCURRENCY + 2;
        const detailGates = Array.from({ length: PR_DETAIL_CONCURRENCY }, () =>
            deferred<Response>()
        );
        const startedDetails: number[] = [];
        installFetch(async (url, init) => {
            if (url.startsWith('https://api.github.com/search/issues?')) {
                return searchResponse(
                    Array.from({ length: itemCount }, (_, index) =>
                        searchItem(index + 1)
                    )
                );
            }
            if (/\/pulls\/\d+$/.test(url)) {
                const number = prNumberFromUrl(url);
                startedDetails.push(number);
                expect(init?.signal).toBeInstanceOf(AbortSignal);
                return detailGates[number - 1]!.promise;
            }
            throw new Error(`Unexpected URL: ${url}`);
        });
        const controller = new AbortController();
        let valid = true;
        const result = fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock(),
            {
                signal: controller.signal,
                isValid: () => valid,
            }
        );
        await vi.waitFor(() => {
            expect(startedDetails).toEqual([1, 2, 3, 4]);
        });

        valid = false;
        controller.abort();
        detailGates.forEach((gate, index) =>
            gate.resolve(jsonResponse(prDetail(index + 1)))
        );

        await expect(result).rejects.toMatchObject({
            name: 'RefreshSessionInvalidatedError',
        });
        expect(startedDetails).toEqual([1, 2, 3, 4]);
    });
});
