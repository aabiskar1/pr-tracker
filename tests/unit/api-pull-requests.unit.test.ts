import browser from 'webextension-polyfill';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchPullRequests,
    type PullRequestFetchResult,
} from '../../src/background/api';
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

const prNumberFromUrl = (url: string): number => {
    const match = url.match(/pulls\/(\d+)/);
    if (!match) throw new Error(`Unexpected PR URL: ${url}`);
    return Number(match[1]);
};

const successfulSupportingResponse = (url: string): Response => {
    if (url.endsWith('/reviews')) return jsonResponse([]);
    if (url.includes('/check-runs')) {
        return jsonResponse({
            check_runs: [
                {
                    status: 'completed',
                    conclusion: 'success',
                },
            ],
        });
    }
    return jsonResponse(prDetail(prNumberFromUrl(url)));
};

const expectSuccessfulPullRequests = (result: PullRequestFetchResult) => {
    expect(result.status).toBe('success');
    if (result.status === 'failure') {
        throw new Error('Expected a successful pull-request search');
    }
    return result.pullRequests;
};

describe('fetchPullRequests search and transformation behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('combines default authored and review-requested searches and deduplicates IDs', async () => {
        const searchUrls: string[] = [];
        const requestedUrls: string[] = [];
        const createNotification = createNotificationMock();

        installFetch((url, init) => {
            requestedUrls.push(url);
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                expect(init?.headers).toEqual({
                    Authorization: `token ${TOKEN}`,
                    Accept: 'application/vnd.github.v3+json',
                });
                const query = queryFromSearchUrl(url);
                if (query.includes('author:')) {
                    return jsonResponse({ items: [searchItem(1)] });
                }
                return jsonResponse({
                    items: [searchItem(1), searchItem(2)],
                });
            }
            if (url.endsWith('/reviews')) {
                const number = prNumberFromUrl(url);
                return jsonResponse(
                    number === 1
                        ? [{ user: { id: 10 }, state: 'APPROVED' }]
                        : [
                              {
                                  user: { id: 11 },
                                  state: 'CHANGES_REQUESTED',
                              },
                          ]
                );
            }
            if (url.includes('/check-runs')) {
                return jsonResponse({
                    check_runs: [
                        {
                            status: 'completed',
                            conclusion: 'success',
                        },
                    ],
                });
            }
            return jsonResponse(prDetail(prNumberFromUrl(url)));
        });

        const result = expectSuccessfulPullRequests(
            await fetchPullRequests(TOKEN, USER, undefined, createNotification)
        );

        expect(searchUrls.map(queryFromSearchUrl)).toEqual([
            'is:open is:pr author:octo-user archived:false',
            'is:open is:pr review-requested:octo-user archived:false',
        ]);
        expect(searchUrls.every((url) => url.endsWith('&per_page=100'))).toBe(
            true
        );
        expect(result).toHaveLength(2);
        expect(result.map((pr) => pr.id)).toEqual([1, 2]);
        expect(result[0]).toEqual({
            id: 1,
            title: 'PR 1',
            html_url: 'https://github.com/acme/repo-1/pull/1',
            repository: { name: 'repo-1' },
            state: 'open',
            draft: false,
            created_at: '2025-01-02T03:04:05.000Z',
            requested_reviewers: [
                {
                    login: 'reviewer',
                    avatar_url: 'https://avatars.example/reviewer.png',
                },
            ],
            review_status: 'approved',
            ci_status: 'passing',
            author: {
                login: 'author',
                avatar_url: 'https://avatars.example/author.png',
            },
        });
        expect(result[1].review_status).toBe('changes-requested');
        expect(createNotification).not.toHaveBeenCalled();
        for (const number of [1, 2]) {
            expect(
                requestedUrls.filter((url) => url === prUrl(number))
            ).toHaveLength(1);
            expect(
                requestedUrls.filter(
                    (url) => url === `${prUrl(number)}/reviews`
                )
            ).toHaveLength(1);
            expect(
                requestedUrls.filter((url) =>
                    url.includes(
                        `/repo-${number}/commits/sha-${number}/check-runs`
                    )
                )
            ).toHaveLength(1);
        }
    });

    it('uses one URL-encoded custom search instead of the defaults', async () => {
        const customQuery =
            'is:pr is:open org:acme label:"needs review" archived:false';
        const searchUrls: string[] = [];

        installFetch((url) => {
            if (isSearchUrl(url)) {
                searchUrls.push(url);
                return jsonResponse({ items: [searchItem(3)] });
            }
            return successfulSupportingResponse(url);
        });

        const result = expectSuccessfulPullRequests(
            await fetchPullRequests(
                TOKEN,
                USER,
                customQuery,
                createNotificationMock()
            )
        );

        expect(result.map((pr) => pr.id)).toEqual([3]);
        expect(searchUrls).toHaveLength(1);
        expect(searchUrls[0]).toContain(encodeURIComponent(customQuery));
        expect(queryFromSearchUrl(searchUrls[0])).toBe(customQuery);
    });

    it('treats whitespace-only custom input as no custom query', async () => {
        const queries: string[] = [];

        installFetch((url) => {
            if (isSearchUrl(url)) {
                queries.push(queryFromSearchUrl(url));
                return jsonResponse({ items: [] });
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        await expect(
            fetchPullRequests(TOKEN, USER, '   \t ', createNotificationMock())
        ).resolves.toEqual({ status: 'success', pullRequests: [] });
        expect(queries).toEqual([
            'is:open is:pr author:octo-user archived:false',
            'is:open is:pr review-requested:octo-user archived:false',
        ]);
    });

    it('reports a failed custom search without returning an empty success', async () => {
        const createNotification = createNotificationMock();

        installFetch((url) => {
            if (isSearchUrl(url)) {
                return jsonResponse({ message: 'Bad credentials' }, 401);
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr repo:acme/private',
            createNotification
        );

        expect(result).toEqual({ status: 'failure' });
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                title: 'PR Tracker Error',
                message: expect.stringContaining('Authentication failed'),
            }),
            true
        );
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message: expect.stringContaining('Authentication failed'),
        });
    });

    it('reports a failed default search without returning an empty success', async () => {
        const createNotification = createNotificationMock();

        installFetch((url) => {
            if (isSearchUrl(url)) {
                const query = queryFromSearchUrl(url);
                return query.includes('author:')
                    ? jsonResponse({ message: 'Service unavailable' }, 503)
                    : jsonResponse({ items: [] });
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            undefined,
            createNotification
        );

        expect(result).toEqual({ status: 'failure' });
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                title: 'PR Tracker Error',
                message: expect.stringContaining(
                    'GitHub servers are experiencing issues (503)'
                ),
            }),
            false
        );
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message: expect.stringContaining(
                'GitHub servers are experiencing issues (503)'
            ),
        });
    });

    it('preserves the current rejected promise behavior for a custom-search network failure', async () => {
        installFetch(() =>
            Promise.reject(new TypeError('network unavailable'))
        );

        await expect(
            fetchPullRequests(
                TOKEN,
                USER,
                'is:pr org:acme',
                createNotificationMock()
            )
        ).rejects.toThrow('network unavailable');
    });

    it('returns no PRs for a search payload without an items collection', async () => {
        installFetch((url) => {
            if (isSearchUrl(url)) return jsonResponse({ total_count: 0 });
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
    });

    it('maps field fallbacks and all repository-name resolution paths', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-06-07T08:09:10.000Z'));

        const details = new Map<number, Record<string, unknown>>([
            [
                10,
                prDetail(10, {
                    title: undefined,
                    state: undefined,
                    draft: undefined,
                    created_at: undefined,
                    requested_reviewers: undefined,
                    user: undefined,
                }),
            ],
            [
                11,
                prDetail(11, {
                    base: undefined,
                    repository: { name: 'repository-field-name' },
                }),
            ],
            [
                12,
                prDetail(12, {
                    base: undefined,
                    repository: undefined,
                    html_url:
                        'https://github.com/fallback-owner/url-derived-repo/pull/12',
                }),
            ],
        ]);

        installFetch((url) => {
            if (isSearchUrl(url)) {
                return jsonResponse({
                    items: [searchItem(10), searchItem(11), searchItem(12)],
                });
            }
            if (url.endsWith('/reviews')) return jsonResponse([]);
            if (url.includes('/check-runs')) {
                return jsonResponse({ check_runs: [] }, 500);
            }
            const detail = details.get(prNumberFromUrl(url));
            if (!detail) throw new Error(`Unexpected URL: ${url}`);
            return jsonResponse(detail);
        });

        const result = expectSuccessfulPullRequests(
            await fetchPullRequests(
                TOKEN,
                USER,
                'is:pr org:acme',
                createNotificationMock()
            )
        );

        expect(result.map((pr) => pr.repository.name)).toEqual([
            'repo-10',
            'repository-field-name',
            'url-derived-repo',
        ]);
        expect(result[0]).toMatchObject({
            title: 'Untitled PR',
            state: 'open',
            draft: false,
            created_at: '2030-06-07T08:09:10.000Z',
            requested_reviewers: [],
            review_status: 'pending',
        });
        expect(result[0].author).toBeUndefined();
    });

    it('rejects a refresh containing missing or unusable required PR identity data', async () => {
        const malformedUrl = 'not-a-valid-pr-url';
        const incompleteUrl = prUrl(21);
        const createNotification = createNotificationMock();

        installFetch((url) => {
            if (isSearchUrl(url)) {
                return jsonResponse({
                    items: [
                        { id: 18 },
                        { id: 19, pull_request: {} },
                        { id: 20, pull_request: { url: malformedUrl } },
                        { id: 21, pull_request: { url: incompleteUrl } },
                        searchItem(22),
                    ],
                });
            }
            if (url === malformedUrl) {
                throw new TypeError('Malformed URL');
            }
            if (url.startsWith(incompleteUrl)) {
                if (url.endsWith('/reviews')) return jsonResponse([]);
                return jsonResponse({ id: 21, head: { sha: 'sha-21' } });
            }
            return successfulSupportingResponse(url);
        });

        await expect(
            fetchPullRequests(TOKEN, USER, 'is:pr org:acme', createNotification)
        ).resolves.toEqual({ status: 'failure' });
        expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it.each([
        {
            label: '404 response',
            response: () => jsonResponse({ message: 'Not Found' }, 404),
        },
        {
            label: '500 response',
            response: () => jsonResponse({ message: 'Server failure' }, 500),
        },
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
            response: () => jsonResponse({ id: 40 }),
        },
    ])('rejects a required detail $label', async ({ response }) => {
        const createNotification = createNotificationMock();

        installFetch((url) => {
            if (isSearchUrl(url)) {
                return jsonResponse({ items: [searchItem(40)] });
            }
            if (url.endsWith('/reviews')) return jsonResponse([]);
            if (url === prUrl(40)) return response();
            return jsonResponse({ check_runs: [] }, 500);
        });

        await expect(
            fetchPullRequests(TOKEN, USER, 'is:pr org:acme', createNotification)
        ).resolves.toEqual({ status: 'failure' });
        expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it('rejects a required detail network failure', async () => {
        const createNotification = createNotificationMock();

        installFetch((url) => {
            if (isSearchUrl(url)) {
                return jsonResponse({ items: [searchItem(41)] });
            }
            if (url.endsWith('/reviews')) return jsonResponse([]);
            if (url === prUrl(41)) {
                return Promise.reject(new TypeError('network unavailable'));
            }
            return jsonResponse({ check_runs: [] }, 500);
        });

        await expect(
            fetchPullRequests(TOKEN, USER, 'is:pr org:acme', createNotification)
        ).resolves.toEqual({ status: 'failure' });
        expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it('rejects the complete refresh when one of multiple required detail requests fails', async () => {
        const createNotification = createNotificationMock();
        const requestedUrls: string[] = [];

        installFetch((url) => {
            requestedUrls.push(url);
            if (isSearchUrl(url)) {
                return jsonResponse({
                    items: [searchItem(30), searchItem(31)],
                });
            }
            if (url === prUrl(30)) {
                return jsonResponse({ message: 'Service unavailable' }, 503);
            }
            return successfulSupportingResponse(url);
        });

        await expect(
            fetchPullRequests(TOKEN, USER, 'is:pr org:acme', createNotification)
        ).resolves.toEqual({ status: 'failure' });
        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                title: 'PR Tracker Error',
                message: expect.stringContaining(
                    'could not be refreshed completely'
                ),
            }),
            false
        );
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message: expect.stringContaining(
                'could not be refreshed completely'
            ),
        });
        expect(requestedUrls.filter((url) => url === prUrl(30))).toHaveLength(
            1
        );
        expect(requestedUrls).not.toContain(`${prUrl(30)}/reviews`);
        expect(
            requestedUrls.some((url) => url.includes('/repo-30/commits/'))
        ).toBe(false);
    });
});
