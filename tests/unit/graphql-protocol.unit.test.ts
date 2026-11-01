import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchPullRequests, analyzeHttpError } from '../../src/background/api';
import {
    investigateGraphql,
    GraphqlInvestigationError,
} from '../../src/experiments/githubGraphql/client';
import { graphqlNode, graphqlPage } from '../fixtures/graphql/responses';
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
    vi.useFakeTimers();
    vi.setSystemTime('2030-01-01T00:00:00Z');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

it('retains HTTP 200 rate-limit metadata but exposes the HTTP-classifier classification gap', async () => {
    const reset = Date.parse('2030-01-01T00:05:00Z');
    const transport = vi.fn<typeof fetch>(async () =>
        jsonResponse(
            {
                errors: [
                    {
                        type: 'RATE_LIMITED',
                        message: 'API rate limit exceeded',
                    },
                ],
            },
            200,
            {
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': String(reset / 1000),
                'x-ratelimit-resource': 'graphql',
            }
        )
    );
    const error = await investigateGraphql({
        token: TOKEN,
        login: USER.login,
        transport,
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(GraphqlInvestigationError);
    if (!(error instanceof GraphqlInvestigationError) || !error.response)
        throw new Error('Expected retained Response');
    const classified = await analyzeHttpError(error.response);
    // Message matching finds the limit/deadline, but the HTTP 200 path does
    // not classify exhausted primary quota as primary. No PoC persistence exists.
    expect(classified).toMatchObject({
        isRateLimit: true,
        rateLimit: {
            classification: 'generic',
            deadlineSource: 'reset',
            nextAllowedAt: reset,
            resource: 'graphql',
        },
    });
    expect(transport).toHaveBeenCalledTimes(1);
});

it('contrasts REST optional-error degradation with GraphQL partial-response rejection', async () => {
    installFetch((url) => {
        if (url.includes('/search/issues?'))
            return searchResponse([searchItem(1)]);
        if (url === prUrl(1)) return jsonResponse(prDetail(1));
        if (url.endsWith('/reviews?per_page=100'))
            return jsonResponse({ message: 'Forbidden' }, 403);
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
    expect(rest.status).toBe('success');
    if (rest.status !== 'success') throw new Error('Expected REST success');
    expect(rest.pullRequests[0]).toMatchObject({
        id: 1,
        review_status: 'pending',
        ci_status: 'passing',
    });
    const transport = vi.fn<typeof fetch>(async () =>
        jsonResponse({
            ...graphqlPage([{ ...graphqlNode(), reviewDecision: null }]),
            errors: [
                {
                    type: 'FORBIDDEN',
                    message: 'Field inaccessible',
                    path: ['search', 'nodes', 0, 'reviewDecision'],
                },
            ],
        })
    );
    await expect(
        investigateGraphql({
            token: TOKEN,
            login: USER.login,
            customQuery: 'is:pr org:acme',
            transport,
        })
    ).rejects.toBeInstanceOf(GraphqlInvestigationError);
    expect(transport).toHaveBeenCalledTimes(1);
});
