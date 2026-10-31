import { expect, it, vi } from 'vitest';
import { instrumentTransport } from '../../src/experiments/githubGraphql/measurement';
import { measureLive } from '../../src/experiments/githubGraphql/liveMeasurement';
import { graphqlPage } from '../fixtures/graphql/responses';
import {
    jsonResponse,
    prDetail,
    searchItem,
    searchResponse,
    USER,
} from './api-test-helpers';

vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));

it('records decoded bytes, resource headers and complete response time without storing payloads', async () => {
    const body = JSON.stringify({ title: 'Private π content' });
    const clock = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(35);
    const original = vi.fn<typeof fetch>(
        async () =>
            new Response(body, {
                headers: {
                    'x-ratelimit-resource': 'core',
                    'x-ratelimit-used': '12',
                },
            })
    );
    const measured = instrumentTransport(original, 1, clock);
    const response = await measured.transport(
        'https://api.github.com/repos/example/repo/pulls/1'
    );
    expect(await response.text()).toBe(body);
    expect(measured.requests).toEqual([
        {
            resource: 'core',
            endpoint: 'detail',
            status: 200,
            bodyBytes: new TextEncoder().encode(body).byteLength,
            elapsedMs: 25,
            used: 12,
        },
    ]);
    expect(JSON.stringify(measured.requests)).not.toContain('Private');
    await expect(
        measured.transport('https://api.github.com/user')
    ).rejects.toThrow('ceiling');
    expect(original).toHaveBeenCalledTimes(1);
});

it('rejects unexpected hosts before transport and keeps unavailable rate metadata null', async () => {
    const original = vi.fn<typeof fetch>(async () => new Response('{}'));
    const measured = instrumentTransport(original);
    await expect(measured.transport('https://example.com')).rejects.toThrow(
        'host'
    );
    expect(original).not.toHaveBeenCalled();
    await measured.transport('https://api.github.com/graphql');
    expect(measured.requests[0]).toMatchObject({
        used: null,
        resource: null,
        endpoint: 'graphql',
    });
});

it('measures internal REST requests as well as GraphQL without live credentials', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const used = { core: 0, search: 0, graphql: 0 };
    const network = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith('/rate_limit'))
            return jsonResponse({
                resources: Object.fromEntries(
                    Object.entries(used).map(([resource, count]) => [
                        resource,
                        {
                            used: count,
                            remaining: 5000 - count,
                            reset: 2000000000,
                        },
                    ])
                ),
            });
        const resource = url.endsWith('/graphql')
            ? 'graphql'
            : url.includes('/search/issues?')
              ? 'search'
              : 'core';
        used[resource]++;
        const response = url.endsWith('/user')
            ? jsonResponse(USER)
            : url.includes('/search/issues?')
              ? searchResponse([searchItem(1)])
              : url.endsWith('/graphql')
                ? jsonResponse(graphqlPage())
                : url.endsWith('/reviews')
                  ? jsonResponse([{ user: { id: 10 }, state: 'APPROVED' }])
                  : new URL(url).pathname.endsWith('/check-runs')
                    ? jsonResponse({
                          total_count: 1,
                          check_runs: [
                              {
                                  id: 1,
                                  status: 'completed',
                                  conclusion: 'success',
                              },
                          ],
                      })
                    : /\/pulls\/1$/.test(url)
                      ? jsonResponse(prDetail(1))
                      : null;
        if (!response) throw new Error('Unexpected fixture request');
        response.headers.set('x-ratelimit-resource', resource);
        response.headers.set('x-ratelimit-used', String(used[resource]));
        return response;
    });
    vi.stubGlobal('fetch', network);
    try {
        const result = await measureLive('fixture-only-token');
        const rest = result.trials.filter(
            (trial) => 'client' in trial && trial.client === 'rest'
        );
        const graphql = result.trials.filter(
            (trial) => 'client' in trial && trial.client === 'graphql'
        );
        expect(rest).toHaveLength(4);
        expect(graphql).toHaveLength(4);
        for (const trial of rest) {
            expect(trial).toMatchObject({
                httpRequests: 5,
                observedBudgetDelta: { core: 4, search: 1, graphql: 0 },
            });
            if ('requests' in trial)
                expect(
                    trial.requests?.map((request) => request.endpoint).sort()
                ).toEqual([
                    'check-runs',
                    'detail',
                    'reviews',
                    'search',
                    'user',
                ]);
        }
        for (const trial of graphql)
            expect(trial).toMatchObject({
                httpRequests: 2,
                graphqlCost: 1,
                observedBudgetDelta: { core: 1, search: 0, graphql: 1 },
            });
        expect(globalThis.fetch).toBe(network);
        expect(JSON.stringify(result)).not.toContain('fixture-only-token');
    } finally {
        vi.unstubAllGlobals();
        log.mockRestore();
    }
});
