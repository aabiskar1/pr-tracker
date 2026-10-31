import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPullRequests } from '../../src/background/api';
import { investigateGraphql } from '../../src/experiments/githubGraphql/client';
import { graphqlNode, graphqlPage } from '../fixtures/graphql/responses';
import {
    graphqlReviewRequests,
    requestedReviewers,
    reviewScenarios,
} from '../fixtures/graphql/review-scenarios';
import {
    createNotificationMock,
    installFetch,
    jsonResponse,
    prDetail,
    prUrl,
    searchItem,
    searchResponse,
    TOKEN,
    USER,
} from './api-test-helpers';

vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('paired reviewer and review-state scenarios', () => {
    it.each(reviewScenarios)('$name', async (scenario) => {
        const restFetch = installFetch((url) => {
            if (url.includes('/search/issues?'))
                return searchResponse([searchItem(1)]);
            if (url === prUrl(1))
                return jsonResponse(
                    prDetail(1, { requested_reviewers: requestedReviewers })
                );
            if (url.endsWith('/reviews')) return jsonResponse(scenario.reviews);
            if (new URL(url).pathname.endsWith('/check-runs'))
                return jsonResponse({
                    total_count: 1,
                    check_runs: [
                        { id: 1, status: 'completed', conclusion: 'success' },
                    ],
                });
            throw new Error('Unexpected fixture request');
        });
        const rest = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );
        const graphFetch = vi.fn<typeof fetch>(async () =>
            jsonResponse(
                graphqlPage([
                    {
                        ...graphqlNode(),
                        reviewDecision: scenario.decision,
                        reviewRequests: graphqlReviewRequests(),
                    },
                ])
            )
        );
        const graph = await investigateGraphql({
            token: TOKEN,
            login: USER.login,
            customQuery: 'is:pr org:acme',
            transport: graphFetch,
        });
        if (rest.status !== 'success') throw new Error('Expected REST success');
        expect(rest.pullRequests).toHaveLength(1);
        expect(graph.pullRequests).toHaveLength(1);
        expect(rest.pullRequests[0].review_status).toBe(scenario.rest);
        expect(graph.pullRequests[0].review_status).toBe(scenario.graphql);
        expect(graph.pullRequests[0].requested_reviewers).toEqual(
            requestedReviewers
        );
        const { review_status: restReview, ...restFields } =
            rest.pullRequests[0];
        const { review_status: graphReview, ...graphFields } =
            graph.pullRequests[0];
        expect(graphFields).toEqual(restFields);
        expect(restReview === graphReview).toBe(
            scenario.rest === scenario.graphql
        );
        expect(restFetch).toHaveBeenCalledTimes(4);
        expect(graphFetch).toHaveBeenCalledTimes(1);
    });
});

describe('later commits and source overlap', () => {
    it.each([
        {
            name: 'approval retained',
            laterState: 'APPROVED',
            decision: 'APPROVED',
            restLabel: 'approved',
            graphLabel: 'approved',
        },
        {
            name: 'approval dismissed',
            laterState: 'DISMISSED',
            decision: 'REVIEW_REQUIRED',
            restLabel: 'pending',
            graphLabel: 'pending',
        },
        {
            name: 'aggregate requires re-review but REST still sees approval',
            laterState: 'APPROVED',
            decision: 'REVIEW_REQUIRED',
            restLabel: 'approved',
            graphLabel: 'pending',
        },
    ])(
        'refreshes current-head CI after a later commit: $name',
        async (scenario) => {
            let later = false;
            const checkUrls: string[] = [];
            const restFetch = installFetch((url) => {
                if (url.includes('/search/issues?'))
                    return searchResponse([searchItem(1)]);
                if (url === prUrl(1))
                    return jsonResponse(
                        prDetail(1, {
                            head: { sha: later ? 'head-new' : 'head-old' },
                        })
                    );
                if (url.endsWith('/reviews'))
                    return jsonResponse([
                        {
                            user: { id: 10 },
                            state: later ? scenario.laterState : 'APPROVED',
                            commit_id: 'head-old',
                        },
                    ]);
                if (new URL(url).pathname.endsWith('/check-runs')) {
                    checkUrls.push(url);
                    return jsonResponse({
                        total_count: 1,
                        check_runs: [
                            {
                                id: 1,
                                status: later ? 'in_progress' : 'completed',
                                conclusion: later ? null : 'success',
                            },
                        ],
                    });
                }
                throw new Error('Unexpected fixture request');
            });
            const graphFetch = vi.fn<typeof fetch>(async () =>
                jsonResponse(
                    graphqlPage([
                        {
                            ...graphqlNode(),
                            reviewDecision: later
                                ? scenario.decision
                                : 'APPROVED',
                            statusCheckRollup: {
                                state: later ? 'PENDING' : 'SUCCESS',
                            },
                        },
                    ])
                )
            );
            const refresh = async () => {
                const rest = await fetchPullRequests(
                    TOKEN,
                    USER,
                    'is:pr org:acme',
                    createNotificationMock()
                );
                const graph = await investigateGraphql({
                    token: TOKEN,
                    login: USER.login,
                    customQuery: 'is:pr org:acme',
                    transport: graphFetch,
                });
                if (rest.status !== 'success')
                    throw new Error('Expected REST success');
                return {
                    rest: rest.pullRequests[0],
                    graph: graph.pullRequests[0],
                };
            };
            const first = await refresh();
            expect(first.rest).toMatchObject({
                id: 1,
                review_status: 'approved',
                ci_status: 'passing',
            });
            expect(first.graph).toEqual(first.rest);
            later = true;
            const second = await refresh();
            expect(second.rest).toMatchObject({
                id: 1,
                review_status: scenario.restLabel,
                ci_status: 'pending',
            });
            expect(second.graph).toMatchObject({
                id: 1,
                review_status: scenario.graphLabel,
                ci_status: 'pending',
            });
            expect(checkUrls).toEqual([
                'https://api.github.com/repos/acme/repo-1/commits/head-old/check-runs?per_page=100&page=1',
                'https://api.github.com/repos/acme/repo-1/commits/head-new/check-runs?per_page=100&page=1',
            ]);
            expect(restFetch).toHaveBeenCalledTimes(8);
            expect(graphFetch).toHaveBeenCalledTimes(2);
            // This exercises successive supplied rollups, not server-side approval
            // dismissal rules or head-SHA pinning (not implemented in the PoC).
        }
    );

    it('unions overlapping sources without losing multiple reviewers or fetching REST details twice', async () => {
        const idsForQuery = (query: string) =>
            query.includes('reviewed-by:')
                ? [1, 2]
                : query.includes('review-requested:')
                  ? [2]
                  : [1];
        const restFetch = installFetch((url) => {
            if (url.includes('/search/issues?'))
                return searchResponse(
                    idsForQuery(new URL(url).searchParams.get('q')!).map(
                        searchItem
                    )
                );
            const match = /\/pulls\/(\d+)(\/reviews)?$/.exec(url);
            if (match) {
                const id = Number(match[1]);
                if (match[2])
                    return jsonResponse(
                        id === 1
                            ? [{ user: { id: 10 }, state: 'COMMENTED' }]
                            : [
                                  { user: { id: 11 }, state: 'APPROVED' },
                                  {
                                      user: { id: 12 },
                                      state: 'CHANGES_REQUESTED',
                                  },
                              ]
                    );
                return jsonResponse(
                    prDetail(id, {
                        requested_reviewers: id === 1 ? [] : requestedReviewers,
                    })
                );
            }
            if (new URL(url).pathname.endsWith('/check-runs'))
                return jsonResponse({
                    total_count: 1,
                    check_runs: [
                        { id: 1, status: 'completed', conclusion: 'success' },
                    ],
                });
            throw new Error('Unexpected fixture request');
        });
        const graphFetch = vi.fn<typeof fetch>(async (_, init) => {
            const query = JSON.parse(String(init?.body)).variables.query;
            return jsonResponse(
                graphqlPage(
                    idsForQuery(query).map((id) => ({
                        ...graphqlNode(id),
                        reviewDecision: id === 1 ? null : 'CHANGES_REQUESTED',
                        reviewRequests: graphqlReviewRequests(
                            id === 1 ? [] : requestedReviewers
                        ),
                    }))
                )
            );
        });
        const rest = await fetchPullRequests(
            TOKEN,
            USER,
            undefined,
            createNotificationMock()
        );
        const graph = await investigateGraphql({
            token: TOKEN,
            login: USER.login,
            transport: graphFetch,
        });
        if (rest.status !== 'success') throw new Error('Expected REST success');
        expect(graph.pullRequests).toEqual(rest.pullRequests);
        expect(
            graph.pullRequests.map((pr) => [pr.id, pr.discoverySources])
        ).toEqual([
            [1, ['authored', 'reviewed']],
            [2, ['review-requested', 'reviewed']],
        ]);
        expect(graph.pullRequests[1]).toMatchObject({
            review_status: 'changes-requested',
            requested_reviewers: requestedReviewers,
        });
        for (const id of [1, 2])
            expect(
                restFetch.mock.calls.filter(([url]) => url === prUrl(id))
            ).toHaveLength(1);
        expect(restFetch).toHaveBeenCalledTimes(9);
        expect(graphFetch).toHaveBeenCalledTimes(3);
    });
});
