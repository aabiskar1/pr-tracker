import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    investigateGraphql,
    GraphqlInvestigationError,
    SEARCH_QUERY,
} from '../../src/experiments/githubGraphql/client';
import {
    defaultDiscoveryFixture,
    graphqlNode,
    graphqlPage,
} from '../fixtures/graphql/responses';
import { fetchPullRequests } from '../../src/background/api';
import {
    createNotificationMock,
    installFetch,
    jsonResponse,
    prDetail,
    searchItem,
    searchResponse,
    TOKEN,
    USER,
} from './api-test-helpers';

vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));

const run = (
    transport: typeof fetch,
    extra: Partial<Parameters<typeof investigateGraphql>[0]> = {}
) =>
    investigateGraphql({
        token: TOKEN,
        login: USER.login,
        transport,
        customQuery: 'is:pr org:acme',
        ...extra,
    });
const transportFor = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>(async () => jsonResponse(body, status));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('isolated GraphQL investigation', () => {
    it('retrieves distinct authored, outstanding-request and reviewed-only PRs with independent pagination', async () => {
        const fixtures = defaultDiscoveryFixture(USER.login);
        const cursors: (string | null)[] = [];
        const transport = vi.fn<typeof fetch>(async (_, init) => {
            const { query, after } = JSON.parse(String(init?.body)).variables;
            cursors.push(after);
            const fixture = fixtures.find((fixture) => fixture.query === query);
            if (!fixture) throw new Error(`Unexpected search: ${query}`);
            const page = fixture.pages[after === 'reviewed-next' ? 1 : 0];
            if (!page) throw new Error('Unexpected continuation');
            return jsonResponse(page);
        });
        const result = await run(transport, { customQuery: undefined });
        const byId = new Map(result.pullRequests.map((pr) => [pr.id, pr]));
        expect(result.pullRequests).toHaveLength(53);
        expect(byId.get(1)).toMatchObject({
            discoverySources: ['authored'],
            draft: true,
            author: { login: USER.login },
        });
        expect(byId.get(2)).toMatchObject({
            discoverySources: ['review-requested'],
            review_status: 'pending',
            requested_reviewers: [{ login: USER.login }],
        });
        expect(byId.get(3)).toMatchObject({
            discoverySources: ['reviewed'],
            review_status: 'changes-requested',
            requested_reviewers: [],
        });
        expect(byId.get(4)?.discoverySources).toEqual([
            'authored',
            'review-requested',
            'reviewed',
        ]);
        expect(byId.get(53)?.discoverySources).toEqual(['reviewed']);
        expect(cursors).toEqual([null, null, null, 'reviewed-next']);
        expect(result.rateLimits).toHaveLength(4);
        expect(result.truncated).toBe(false);
        expect(transport).toHaveBeenCalledTimes(4);
    });

    it.each(['author:', 'review-requested:', 'reviewed-by:'])(
        'rejects a failed required %s discovery source',
        async (qualifier) => {
            const transport = vi.fn<typeof fetch>(async (_, init) => {
                const { query } = JSON.parse(String(init?.body)).variables;
                return jsonResponse(
                    query.includes(qualifier)
                        ? { errors: [{ type: 'FORBIDDEN' }] }
                        : graphqlPage([graphqlNode()])
                );
            });
            await expect(
                run(transport, { customQuery: undefined })
            ).rejects.toBeInstanceOf(GraphqlInvestigationError);
        }
    );

    it('rejects a failed reviewed-search continuation after other sources succeeded', async () => {
        const transport = vi.fn<typeof fetch>(async (_, init) => {
            const { query, after } = JSON.parse(String(init?.body)).variables;
            if (after)
                return jsonResponse({ errors: [{ type: 'RATE_LIMITED' }] });
            const fixture = defaultDiscoveryFixture(USER.login).find(
                (fixture) => fixture.query === query
            );
            if (!fixture) throw new Error('Unexpected search');
            return jsonResponse(fixture.pages[0]);
        });
        await expect(
            run(transport, { customQuery: undefined })
        ).rejects.toBeInstanceOf(GraphqlInvestigationError);
        expect(transport).toHaveBeenCalledTimes(4);
    });

    it('checks all three sources when default discovery is empty', async () => {
        const transport = transportFor(graphqlPage([]));
        const result = await run(transport, { customQuery: '   ' });
        expect(result.pullRequests).toEqual([]);
        expect(transport).toHaveBeenCalledTimes(3);
    });

    it('maps stable identity and common fields and sends search as variables', async () => {
        const transport = transportFor(graphqlPage());
        const result = await run(transport, {
            customQuery: 'is:pr "quoted title"',
        });
        expect(result.pullRequests[0]).toMatchObject({
            id: 1,
            title: 'PR 1',
            repository: { name: 'repo-1' },
            state: 'open',
            draft: false,
            review_status: 'approved',
            ci_status: 'passing',
            requested_reviewers: [{ login: 'reviewer' }],
            author: { login: 'author' },
        });
        expect(result.pullRequests[0]).not.toHaveProperty('discoverySources');
        expect(result.rateLimits).toEqual([graphqlPage().data.rateLimit]);
        expect(transport).toHaveBeenCalledWith(
            'https://api.github.com/graphql',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json',
                },
            })
        );
        expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
            query: SEARCH_QUERY,
            variables: { query: 'is:pr "quoted title"', after: null },
        });
    });

    it('unions all three discovery sources, excludes stale closed hits, retains closed custom hits', async () => {
        const closed = { ...graphqlNode(2), state: 'MERGED' };
        const transport = transportFor(graphqlPage([graphqlNode(), closed]));
        const result = await run(transport, { customQuery: undefined });
        expect(result.pullRequests).toHaveLength(1);
        expect(result.pullRequests[0].discoverySources).toEqual([
            'authored',
            'review-requested',
            'reviewed',
        ]);
        expect(
            transport.mock.calls.map(
                ([, init]) => JSON.parse(String(init?.body)).variables.query
            )
        ).toEqual([
            `is:open is:pr author:${USER.login} archived:false`,
            `is:open is:pr review-requested:${USER.login} archived:false`,
            `is:open is:pr reviewed-by:${USER.login} archived:false`,
        ]);
        expect(
            (await run(transportFor(graphqlPage([closed])))).pullRequests[0]
                .state
        ).toBe('closed');
    });

    it('paginates sequentially and stops at the reported count', async () => {
        const transport = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                jsonResponse(graphqlPage([graphqlNode()], 2, 'cursor-1', true))
            )
            .mockResolvedValueOnce(
                jsonResponse(graphqlPage([graphqlNode(2)], 2, 'cursor-2'))
            );
        expect((await run(transport)).pullRequests.map((pr) => pr.id)).toEqual([
            1, 2,
        ]);
        expect(
            JSON.parse(String(transport.mock.calls[1][1]?.body)).variables.after
        ).toBe('cursor-1');
    });

    it('handles empty search and exposes the 1000-result ceiling explicitly', async () => {
        expect((await run(transportFor(graphqlPage([])))).pullRequests).toEqual(
            []
        );
        let page = 0;
        const transport = vi.fn<typeof fetch>(async () => {
            const start = page++ * 50;
            return jsonResponse(
                graphqlPage(
                    Array.from({ length: 50 }, (_, i) =>
                        graphqlNode(start + i + 1)
                    ),
                    1200,
                    `cursor-${page}`,
                    true
                )
            );
        });
        const result = await run(transport);
        expect(result.truncated).toBe(true);
        expect(result.pullRequests).toHaveLength(1000);
        expect(transport).toHaveBeenCalledTimes(20);
    });

    it.each([
        graphqlPage([null]),
        graphqlPage([{ __typename: 'Issue' }]),
        graphqlPage([{ ...graphqlNode(), fullDatabaseId: '9007199254740993' }]),
        graphqlPage([{ ...graphqlNode(), fullDatabaseId: null }]),
        graphqlPage([
            {
                ...graphqlNode(),
                reviewRequests: { pageInfo: { hasNextPage: true }, nodes: [] },
            },
        ]),
        graphqlPage([{ ...graphqlNode(), reviewRequests: null }]),
        graphqlPage([{ ...graphqlNode(), reviewDecision: 'NEW_ENUM' }]),
        graphqlPage([graphqlNode()], 2),
        graphqlPage([], 1, 'cursor', true),
        graphqlPage([graphqlNode()], 2, null, true),
        graphqlPage([graphqlNode()], 0),
        graphqlPage([graphqlNode()], 1, 'cursor', true),
        graphqlPage([graphqlNode(), graphqlNode()]),
        { data: null },
    ])('rejects unusable or incomplete data (%#)', async (body) => {
        await expect(run(transportFor(body))).rejects.toThrow();
    });

    it('rejects repeated cursors and a later-page failure without returning partial results', async () => {
        const repeated = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                jsonResponse(graphqlPage([graphqlNode()], 3, 'same', true))
            )
            .mockResolvedValueOnce(
                jsonResponse(graphqlPage([graphqlNode(2)], 3, 'same', true))
            );
        await expect(run(repeated)).rejects.toThrow('pagination');
        const failed = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                jsonResponse(graphqlPage([graphqlNode()], 2, 'next', true))
            )
            .mockResolvedValueOnce(
                jsonResponse({ errors: [{ type: 'FORBIDDEN' }] })
            );
        await expect(run(failed)).rejects.toBeInstanceOf(
            GraphqlInvestigationError
        );
    });

    it.each([401, 403, 429, 502])(
        'preserves HTTP %i metadata and never retries',
        async (status) => {
            const transport = vi.fn<typeof fetch>(async () =>
                jsonResponse({}, status, { 'retry-after': '60' })
            );
            const error = await run(transport).catch((error: unknown) => error);
            expect(error).toBeInstanceOf(GraphqlInvestigationError);
            expect(
                (error as GraphqlInvestigationError).response?.headers.get(
                    'retry-after'
                )
            ).toBe('60');
            expect(transport).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['RATE_LIMITED', 'FORBIDDEN', 'MAX_NODE_LIMIT_EXCEEDED'])(
        'rejects HTTP 200 errors with partial data (%s)',
        async (type) => {
            const body = {
                ...graphqlPage(),
                errors: [{ type, message: 'synthetic error' }],
            };
            const transport = transportFor(body);
            const error = await run(transport).catch((error: unknown) => error);
            expect(error).toBeInstanceOf(GraphqlInvestigationError);
            expect(
                await (error as GraphqlInvestigationError).response?.json()
            ).toEqual(body);
            expect(transport).toHaveBeenCalledTimes(1);
        }
    );

    it('propagates network and invalid JSON failures without retry', async () => {
        const network = vi
            .fn<typeof fetch>()
            .mockRejectedValue(new Error('offline'));
        await expect(run(network)).rejects.toThrow('offline');
        expect(network).toHaveBeenCalledTimes(1);
        await expect(
            run(vi.fn<typeof fetch>(async () => new Response('invalid json')))
        ).rejects.toThrow();
    });

    it('honours cancellation before and after transport without a late result', async () => {
        const controller = new AbortController();
        const transport = transportFor(graphqlPage());
        controller.abort();
        await expect(
            run(transport, { signal: controller.signal })
        ).rejects.toThrow();
        expect(transport).not.toHaveBeenCalled();
        const late = new AbortController();
        const lateTransport = vi.fn<typeof fetch>(async () => {
            late.abort();
            return jsonResponse(graphqlPage());
        });
        await expect(
            run(lateTransport, { signal: late.signal })
        ).rejects.toThrow();
        expect(lateTransport.mock.calls[0][1]?.signal).toBe(late.signal);
    });

    it.each([
        ['APPROVED', 'SUCCESS', 'approved', 'passing'],
        ['CHANGES_REQUESTED', 'FAILURE', 'changes-requested', 'failing'],
        ['REVIEW_REQUIRED', 'ERROR', 'pending', 'failing'],
        [null, 'PENDING', 'pending', 'pending'],
        [null, 'EXPECTED', 'pending', 'pending'],
        [null, null, 'pending', 'pending'],
    ])(
        'maps summary states (%s/%s)',
        async (reviewDecision, state, review, ci) => {
            const node = {
                ...graphqlNode(),
                reviewDecision,
                statusCheckRollup: state ? { state } : null,
                author: null,
            };
            const result = await run(transportFor(graphqlPage([node])));
            expect(result.pullRequests[0]).toMatchObject({
                review_status: review,
                ci_status: ci,
                author: undefined,
            });
        }
    );

    it('omits team requests while keeping user-like reviewers', async () => {
        const node = graphqlNode();
        const body = {
            ...node,
            reviewRequests: {
                pageInfo: { hasNextPage: false },
                nodes: [
                    { requestedReviewer: { __typename: 'Team' } },
                    {
                        requestedReviewer: {
                            __typename: 'Bot',
                            login: 'bot',
                            avatarUrl: 'https://avatars.example/bot',
                        },
                    },
                ],
            },
        };
        expect(
            (await run(transportFor(graphqlPage([body])))).pullRequests[0]
                .requested_reviewers
        ).toEqual([
            { login: 'bot', avatar_url: 'https://avatars.example/bot' },
        ]);
    });
});

describe('deterministic REST/GraphQL request comparison', () => {
    it.each(
        [1, 10, 50, 100].flatMap((count) => [
            { count, custom: false, fallback: false },
            { count, custom: true, fallback: false },
            { count, custom: false, fallback: true },
        ])
    )(
        'compares parity/counts: $count PRs, custom=$custom, fallback=$fallback',
        async ({ count, custom, fallback }) => {
            vi.spyOn(console, 'log').mockImplementation(() => undefined);
            const nodes = Array.from({ length: count }, (_, i) =>
                graphqlNode(i + 1)
            );
            const rest = installFetch((url) => {
                if (url.includes('/search/issues?'))
                    return searchResponse(
                        nodes.map((_, i) => searchItem(i + 1))
                    );
                if (url.endsWith('/reviews'))
                    return jsonResponse([
                        { user: { id: 10 }, state: 'APPROVED' },
                    ]);
                if (new URL(url).pathname.endsWith('/check-runs'))
                    return jsonResponse({
                        total_count: fallback ? 0 : 1,
                        check_runs: fallback
                            ? []
                            : [
                                  {
                                      id: 1,
                                      status: 'completed',
                                      conclusion: 'success',
                                  },
                              ],
                    });
                if (url.endsWith('/status'))
                    return jsonResponse({
                        state: 'success',
                        total_count: 1,
                        statuses: [{ state: 'success' }],
                    });
                const match = /\/pulls\/(\d+)$/.exec(url);
                if (match) return jsonResponse(prDetail(Number(match[1])));
                throw new Error(`Unexpected fixture URL: ${url}`);
            });
            const restResult = await fetchPullRequests(
                TOKEN,
                USER,
                custom ? 'is:pr org:acme' : undefined,
                createNotificationMock()
            );
            expect(restResult.status).toBe('success');
            if (restResult.status !== 'success') throw new Error('REST failed');
            const graph = vi.fn<typeof fetch>(async (_, init) => {
                const { after } = JSON.parse(String(init?.body)).variables;
                const start = after ? Number(after) : 0;
                const end = Math.min(start + 50, count);
                return jsonResponse(
                    graphqlPage(
                        nodes.slice(start, end),
                        count,
                        String(end),
                        end < count
                    )
                );
            });
            const graphResult = await run(graph, {
                customQuery: custom ? 'is:pr org:acme' : undefined,
            });
            expect(graphResult.pullRequests).toEqual(restResult.pullRequests);
            // Both exclude prManager's separate GET /user. All three searches
            // deliberately overlap completely to exercise pre-detail deduplication.
            const searches = custom ? 1 : 3;
            expect(rest).toHaveBeenCalledTimes(
                searches + (fallback ? 4 : 3) * count
            );
            expect(graph).toHaveBeenCalledTimes(
                searches * Math.ceil(count / 50)
            );
        }
    );

    it('demonstrates that summary substitution changes review and CI behaviour', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        installFetch((url) => {
            if (url.includes('/search/issues?'))
                return searchResponse([searchItem(1)]);
            if (url.endsWith('/reviews'))
                return jsonResponse([{ user: { id: 10 }, state: 'APPROVED' }]);
            if (new URL(url).pathname.endsWith('/check-runs'))
                return jsonResponse({
                    total_count: 1,
                    check_runs: [
                        { id: 1, status: 'completed', conclusion: 'success' },
                    ],
                });
            return jsonResponse(prDetail(1));
        });
        const rest = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );
        const graph = await run(
            transportFor(
                graphqlPage([
                    {
                        ...graphqlNode(),
                        reviewDecision: 'REVIEW_REQUIRED',
                        statusCheckRollup: { state: 'FAILURE' },
                    },
                ])
            )
        );
        if (rest.status !== 'success') throw new Error('REST failed');
        expect(rest.pullRequests[0]).toMatchObject({
            review_status: 'approved',
            ci_status: 'passing',
        });
        expect(graph.pullRequests[0]).toMatchObject({
            review_status: 'pending',
            ci_status: 'failing',
        });
    });
});
