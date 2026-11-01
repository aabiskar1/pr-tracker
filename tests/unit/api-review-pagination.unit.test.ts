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

const reviewUrl = `${prUrl(40)}/reviews`;
const pageUrl = (page: number) =>
    `${reviewUrl}?per_page=100${page > 1 ? `&page=${page}` : ''}`;
const nextLink = (page: number) => `<${pageUrl(page)}>; rel="next"`;
const reviews = (count: number, state = 'COMMENTED') =>
    Array.from({ length: count }, (_, index) => ({
        user: { id: index + 1 },
        state,
    }));
const paged = (items: unknown[], page: number) =>
    jsonResponse(items.slice((page - 1) * 100, page * 100), 200, {
        ...(page * 100 < items.length ? { Link: nextLink(page + 1) } : {}),
    });

function scenario(
    respond: (page: number) => Response | Promise<Response>,
    session?: RefreshSessionContext
) {
    const requestedUrls: string[] = [];
    const notify = createNotificationMock();
    installFetch((url) => {
        requestedUrls.push(url);
        if (url.includes('/search/issues?'))
            return searchResponse([searchItem(40)]);
        if (url === prUrl(40)) return jsonResponse(prDetail(40));
        if (url.includes('/check-runs'))
            return jsonResponse({
                total_count: 1,
                check_runs: [
                    { id: 1, status: 'completed', conclusion: 'success' },
                ],
            });
        if (url.startsWith(`${reviewUrl}?`)) {
            const parsed = new URL(url);
            const page = Number(parsed.searchParams.get('page') ?? 1);
            return respond(page);
        }
        throw new Error(`Unexpected URL: ${url}`);
    });
    const result = fetchPullRequests(
        TOKEN,
        USER,
        'is:pr org:acme',
        notify,
        session
    );
    return { result, requestedUrls, notify };
}

async function status(result: ReturnType<typeof scenario>['result']) {
    const value = await result;
    expect(value.status).toBe('success');
    if (value.status !== 'success') throw new Error('Expected PR detail');
    return {
        review: value.pullRequests[0].review_status,
        rateLimit: value.rateLimit,
        ci: value.pullRequests[0].ci_status,
    };
}

describe('REST review-history pagination', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([0, 30, 100, 101, 250, 1000])(
        'collects %i reviews in the minimum number of requests',
        async (count) => {
            const test = scenario((page) => paged(reviews(count), page));
            expect(await status(test.result)).toMatchObject({
                review: 'pending',
                ci: 'passing',
            });
            expect(
                test.requestedUrls.filter((url) => url.startsWith(reviewUrl))
            ).toEqual(
                Array.from(
                    { length: Math.max(1, Math.ceil(count / 100)) },
                    (_, index) => pageUrl(index + 1)
                )
            );
            expect(test.notify).not.toHaveBeenCalled();
        }
    );

    it.each([
        {
            label: 'later change request supersedes approval',
            first: 'APPROVED',
            last: 'CHANGES_REQUESTED',
            expected: 'changes-requested',
        },
        {
            label: 'later approval supersedes change request',
            first: 'CHANGES_REQUESTED',
            last: 'APPROVED',
            expected: 'approved',
        },
        {
            label: 'later dismissed review supersedes approval',
            first: 'APPROVED',
            last: 'DISMISSED',
            expected: 'pending',
        },
        {
            label: 'later pending review supersedes change request',
            first: 'CHANGES_REQUESTED',
            last: 'PENDING',
            expected: 'pending',
        },
        {
            label: 'later comment supersedes approval',
            first: 'APPROVED',
            last: 'COMMENTED',
            expected: 'pending',
        },
    ])('$label across pages', async ({ first, last, expected }) => {
        const items = reviews(101);
        items[0] = { user: { id: 1 }, state: first };
        items[100] = { user: { id: 1 }, state: last };
        const test = scenario((page) => paged(items, page));
        expect((await status(test.result)).review).toBe(expected);
    });

    it('prioritizes another reviewer’s latest change request', async () => {
        const items = reviews(101);
        items[0] = { user: { id: 1 }, state: 'CHANGES_REQUESTED' };
        items[1] = { user: { id: 2 }, state: 'CHANGES_REQUESTED' };
        items[100] = { user: { id: 1 }, state: 'APPROVED' };
        const test = scenario((page) => paged(items, page));
        expect((await status(test.result)).review).toBe('changes-requested');
    });

    it.each(['network', 'http', 'json'])(
        'does not classify partial history after a page-two %s failure',
        async (failure) => {
            const test = scenario((page) => {
                if (page === 1) return paged(reviews(101, 'APPROVED'), 1);
                if (failure === 'network') throw new TypeError('offline');
                if (failure === 'http')
                    return jsonResponse({ message: 'unavailable' }, 503);
                return new Response('{', { status: 200 });
            });
            expect((await status(test.result)).review).toBe('pending');
            expect(
                test.requestedUrls.filter((url) => url.startsWith(reviewUrl))
            ).toHaveLength(2);
        }
    );

    it.each([403, 429])(
        'propagates recognized rate limit on later page (%i)',
        async (httpStatus) => {
            vi.useFakeTimers();
            vi.setSystemTime('2030-01-01T00:00:00.000Z');
            const test = scenario((page) =>
                page === 1
                    ? paged(reviews(101, 'APPROVED'), 1)
                    : jsonResponse(
                          {
                              message:
                                  'You have exceeded a secondary rate limit.',
                          },
                          httpStatus,
                          { 'retry-after': '90' }
                      )
            );
            expect(await status(test.result)).toMatchObject({
                review: 'pending',
                rateLimit: {
                    classification: 'secondary',
                    deadlineSource: 'retry-after',
                },
            });
        }
    );

    it.each([
        { label: 'object body', response: jsonResponse({ reviews: [] }) },
        { label: 'null record', response: jsonResponse([null]) },
        {
            label: 'missing reviewer',
            response: jsonResponse([{ state: 'APPROVED' }]),
        },
        {
            label: 'invalid state',
            response: jsonResponse([{ user: { id: 1 }, state: 1 }]),
        },
        {
            label: 'unknown state',
            response: jsonResponse([{ user: { id: 1 }, state: 'BOGUS' }]),
        },
        { label: 'oversized page', response: jsonResponse(reviews(101)) },
    ])('degrades malformed $label to pending', async ({ response }) => {
        const test = scenario(() => response);
        expect((await status(test.result)).review).toBe('pending');
        expect(
            test.requestedUrls.filter((url) => url.startsWith(reviewUrl))
        ).toHaveLength(1);
    });

    it.each([
        '<https://example.com/reviews?page=2&per_page=100>; rel="next"',
        `<${reviewUrl}?per_page=100&page=2&extra=1>; rel="next"`,
        `<${pageUrl(1)}>; rel="next"`,
        `<${pageUrl(3)}>; rel="next"`,
        `<${pageUrl(2)}>; rel="next", <${pageUrl(2)}>; rel="next"`,
        'not a link',
    ])('rejects malformed or cyclic next links: %s', async (link) => {
        const test = scenario(() =>
            jsonResponse(reviews(100, 'APPROVED'), 200, { Link: link })
        );
        expect((await status(test.result)).review).toBe('pending');
        expect(
            test.requestedUrls.filter((url) => url.startsWith(reviewUrl))
        ).toHaveLength(1);
    });

    it('rejects a next link beyond the ten-page safety limit', async () => {
        const test = scenario((page) =>
            jsonResponse(reviews(100, 'APPROVED'), 200, {
                Link: nextLink(page + 1),
            })
        );
        expect((await status(test.result)).review).toBe('pending');
        expect(
            test.requestedUrls.filter((url) => url.startsWith(reviewUrl))
        ).toHaveLength(10);
    });

    it('stops before any request when the session is already invalid', async () => {
        const controller = new AbortController();
        controller.abort();
        const test = scenario(() => jsonResponse([]), {
            signal: controller.signal,
            isValid: () => true,
        });
        await expect(test.result).rejects.toThrow('invalidated');
        expect(test.requestedUrls).toEqual([]);
    });

    it('does not request a later page after session invalidation', async () => {
        const controller = new AbortController();
        const test = scenario(
            (page) => {
                if (page === 1) {
                    controller.abort();
                    return paged(reviews(101, 'APPROVED'), page);
                }
                throw new Error('A second review page must not start');
            },
            { signal: controller.signal, isValid: () => true }
        );
        await expect(test.result).rejects.toThrow('invalidated');
        expect(
            test.requestedUrls.filter((url) => url.startsWith(reviewUrl))
        ).toEqual([pageUrl(1)]);
        expect(test.notify).not.toHaveBeenCalled();
    });

    it('stops when the session generation changes after parsing a page', async () => {
        let valid = true;
        const controller = new AbortController();
        const test = scenario(
            () => {
                const response = paged(reviews(101, 'APPROVED'), 1);
                vi.spyOn(response, 'json').mockImplementation(async () => {
                    valid = false;
                    return reviews(100, 'APPROVED');
                });
                return response;
            },
            { signal: controller.signal, isValid: () => valid }
        );
        await expect(test.result).rejects.toThrow('invalidated');
        expect(
            test.requestedUrls.filter((url) => url.startsWith(reviewUrl))
        ).toEqual([pageUrl(1)]);
        expect(test.notify).not.toHaveBeenCalled();
    });
});
