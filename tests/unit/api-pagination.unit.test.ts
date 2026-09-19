import browser from 'webextension-polyfill';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPullRequests } from '../../src/background/api';
import {
    TOKEN,
    USER,
    createNotificationMock,
    installFetch,
    jsonResponse,
    prDetail,
    prUrl,
    queryFromSearchUrl,
    searchItem,
} from './api-test-helpers';

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

const isSearchUrl = (url: string) =>
    url.startsWith('https://api.github.com/search/issues?');

const searchPayload = (
    items: ReturnType<typeof searchItem>[],
    totalCount = items.length,
    incompleteResults = false
) => ({
    total_count: totalCount,
    incomplete_results: incompleteResults,
    items,
});

const searchPage = (url: string): number =>
    Number(new URL(url).searchParams.get('page') ?? 1);

const itemRange = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => searchItem(start + index));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const supportingResponse = (url: string): Response => {
    if (url.endsWith('/reviews')) return jsonResponse([]);
    if (url.includes('/check-runs')) {
        return jsonResponse({
            check_runs: [{ status: 'completed', conclusion: 'success' }],
        });
    }
    const match = url.match(/pulls\/(\d+)/);
    if (!match) throw new Error(`Unexpected URL: ${url}`);
    return jsonResponse(prDetail(Number(match[1])));
};

describe('GitHub issue-search pagination', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('requests one page for fewer than 100 custom-query results', async () => {
        const searchUrls: string[] = [];
        installFetch((url) => {
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                return jsonResponse(searchPayload(itemRange(1, 2)));
            }
            return supportingResponse(url);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );

        expect(result.status).toBe('success');
        expect(searchUrls).toHaveLength(1);
        expect(new URL(searchUrls[0]).searchParams.get('per_page')).toBe('100');
        expect(new URL(searchUrls[0]).searchParams.get('page')).toBe('1');
        expect(queryFromSearchUrl(searchUrls[0])).toBe('is:pr org:acme');
    });

    it('combines two custom-query pages before fetching PR details', async () => {
        const searchUrls: string[] = [];
        const directDetailUrls: string[] = [];
        installFetch((url) => {
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                const page = searchPage(url);
                return jsonResponse(
                    searchPayload(
                        page === 1 ? itemRange(1, 100) : itemRange(101, 2),
                        102
                    )
                );
            }
            if (/\/pulls\/\d+$/.test(url)) directDetailUrls.push(url);
            return supportingResponse(url);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );

        expect(result.status).toBe('success');
        if (result.status === 'success') {
            expect(result.pullRequests).toHaveLength(102);
        }
        expect(searchUrls.map(searchPage)).toEqual([1, 2]);
        expect(directDetailUrls).toHaveLength(102);
    });

    it('does not request an extra page for exactly 100 results', async () => {
        const searchUrls: string[] = [];
        installFetch((url) => {
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                return jsonResponse(searchPayload(itemRange(1, 100), 100));
            }
            return supportingResponse(url);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );

        expect(result.status).toBe('success');
        expect(searchUrls.map(searchPage)).toEqual([1]);
    });

    it('paginates both default searches and deduplicates overlaps before detail requests', async () => {
        const searchUrls: string[] = [];
        const requestedUrls: string[] = [];
        installFetch((url) => {
            requestedUrls.push(url);
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                const query = queryFromSearchUrl(url);
                const page = searchPage(url);
                if (query.includes('author:')) {
                    return jsonResponse(
                        searchPayload(
                            page === 1
                                ? Array.from({ length: 100 }, () =>
                                      searchItem(1)
                                  )
                                : [searchItem(2)],
                            101
                        )
                    );
                }
                return jsonResponse(
                    searchPayload(
                        page === 1
                            ? Array.from({ length: 100 }, () => searchItem(2))
                            : [searchItem(3)],
                        101
                    )
                );
            }
            return supportingResponse(url);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            undefined,
            createNotificationMock()
        );

        expect(result.status).toBe('success');
        if (result.status === 'success') {
            expect(result.pullRequests.map((pr) => pr.id)).toEqual([1, 2, 3]);
        }
        const authoredPages = searchUrls
            .filter((url) => queryFromSearchUrl(url).includes('author:'))
            .map(searchPage);
        const reviewPages = searchUrls
            .filter((url) =>
                queryFromSearchUrl(url).includes('review-requested:')
            )
            .map(searchPage);
        expect(authoredPages).toEqual([1, 2]);
        expect(reviewPages).toEqual([1, 2]);
        for (const number of [1, 2, 3]) {
            expect(
                requestedUrls.filter((url) => url === prUrl(number))
            ).toHaveLength(1);
        }
    });

    it('fails the complete search when page 2 returns an HTTP error', async () => {
        const createNotification = createNotificationMock();
        const requestedUrls: string[] = [];
        installFetch((url) => {
            requestedUrls.push(url);
            if (isSearchUrl(url)) {
                return searchPage(url) === 1
                    ? jsonResponse(
                          searchPayload(
                              Array.from({ length: 100 }, () => searchItem(1)),
                              101
                          )
                      )
                    : jsonResponse({ message: 'Service unavailable' }, 503);
            }
            throw new Error(`Unexpected detail request: ${url}`);
        });

        await expect(
            fetchPullRequests(TOKEN, USER, 'is:pr org:acme', createNotification)
        ).resolves.toEqual({ status: 'failure' });
        expect(requestedUrls.filter(isSearchUrl).map(searchPage)).toEqual([
            1, 2,
        ]);
        expect(requestedUrls.every(isSearchUrl)).toBe(true);
        expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it.each([
        {
            label: 'invalid JSON',
            response: () =>
                new Response('{not-json', {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
        },
        {
            label: 'malformed payload',
            response: () =>
                jsonResponse({
                    total_count: 101,
                    incomplete_results: false,
                    items: 'not-an-array',
                }),
        },
    ])('fails the complete search for page 2 $label', async ({ response }) => {
        const createNotification = createNotificationMock();
        const requestedUrls: string[] = [];
        installFetch((url) => {
            requestedUrls.push(url);
            if (!isSearchUrl(url)) {
                throw new Error(`Unexpected detail request: ${url}`);
            }
            return searchPage(url) === 1
                ? jsonResponse(
                      searchPayload(
                          Array.from({ length: 100 }, () => searchItem(1)),
                          101
                      )
                  )
                : response();
        });

        await expect(
            fetchPullRequests(TOKEN, USER, 'is:pr org:acme', createNotification)
        ).resolves.toEqual({ status: 'failure' });
        expect(requestedUrls.every(isSearchUrl)).toBe(true);
        expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it('rejects incomplete_results instead of persisting an uncertain subset', async () => {
        const createNotification = createNotificationMock();
        const requestedUrls: string[] = [];
        installFetch((url) => {
            requestedUrls.push(url);
            if (isSearchUrl(url)) {
                return jsonResponse(searchPayload([searchItem(1)], 2, true));
            }
            throw new Error(`Unexpected detail request: ${url}`);
        });

        await expect(
            fetchPullRequests(TOKEN, USER, 'is:pr org:acme', createNotification)
        ).resolves.toEqual({ status: 'failure' });
        expect(requestedUrls).toHaveLength(1);
        expect(requestedUrls.every(isSearchUrl)).toBe(true);
        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message: expect.stringContaining(
                'could not be refreshed completely'
            ),
        });
    });

    it('keeps a successful zero-result search empty', async () => {
        const searchUrls: string[] = [];
        installFetch((url) => {
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                return jsonResponse(searchPayload([], 0));
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        await expect(
            fetchPullRequests(
                TOKEN,
                USER,
                'is:pr org:acme',
                createNotificationMock()
            )
        ).resolves.toEqual({ status: 'success', pullRequests: [] });
        expect(searchUrls.map(searchPage)).toEqual([1]);
    });

    it("stops at GitHub's documented 1,000-result search ceiling", async () => {
        const searchUrls: string[] = [];
        installFetch((url) => {
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                return jsonResponse(
                    searchPayload(
                        Array.from({ length: 100 }, () => searchItem(1)),
                        1500
                    )
                );
            }
            return supportingResponse(url);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );

        expect(result.status).toBe('success');
        expect(searchUrls.map(searchPage)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
    });

    it('does not dispatch a later page after its refresh session is invalidated', async () => {
        const firstPage = deferred<Response>();
        const requestedPages: number[] = [];
        const fetchMock = installFetch(async (url, init) => {
            if (!isSearchUrl(url)) return supportingResponse(url);
            requestedPages.push(searchPage(url));
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            return firstPage.promise;
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
            expect(fetchMock).toHaveBeenCalledOnce();
        });

        valid = false;
        controller.abort();
        firstPage.resolve(jsonResponse(searchPayload(itemRange(1, 100), 101)));

        await expect(result).rejects.toMatchObject({
            name: 'RefreshSessionInvalidatedError',
        });
        expect(requestedPages).toEqual([1]);
    });
});
