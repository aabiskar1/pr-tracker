import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    fetchMetadata,
    mapMetadata,
    metadataQuery,
    targetFromUrl,
    HybridMetadataError,
} from '../../src/experiments/hybridMetadata/client';
import { createHybridTransport } from '../../src/experiments/hybridMetadata/transport';
import {
    pairedFixture,
    fixtureTransport,
} from '../../src/experiments/hybridMetadata/fixtures';
import {
    benchmarkFixtures,
    fieldDifferences,
    runTrial,
} from '../../src/experiments/hybridMetadata/benchmark';
import { diagnoseLiveMetadata } from '../../src/experiments/hybridMetadata/live';
vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));
const TOKEN = 'only-a-test-token';
const fixture = pairedFixture(4);
const rate = { cost: 2, remaining: 4998, resetAt: '2030-01-01T01:00:00Z' };
const envelope = (node: unknown = fixture.node) => ({
    data: { p0: { pullRequest: node }, rateLimit: rate },
});
const run = (
    transport: typeof fetch,
    urls = [fixture.url],
    extra: Partial<Parameters<typeof fetchMetadata>[1]> = {}
) => fetchMetadata(urls, { token: TOKEN, transport, ...extra });
const response = (body: unknown, status = 200, headers?: HeadersInit) =>
    new Response(JSON.stringify(body), { status, headers });
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('isolated hybrid metadata', () => {
    it('constructs bounded variable-only aliases across repositories without summaries', () => {
        const targets = [pairedFixture(1).target, pairedFixture(2).target];
        const query = metadataQuery(targets);
        expect(query.query).toContain('TrackerHybridMetadata');
        expect(query.query).toContain('p1:repository');
        expect(query.query).toContain('reviewRequests(first:100)');
        expect(query.query).not.toMatch(
            /reviewDecision|statusCheckRollup|search\(/
        );
        expect(query.query).not.toContain(targets[0]!.owner);
        expect(query.variables).toMatchObject({
            o0: targets[0]!.owner,
            n1: targets[1]!.number,
        });
        expect(() => metadataQuery([])).toThrow();
        expect(() => metadataQuery(Array(51).fill(targets[0]))).toThrow();
    });
    it.each([
        'https://evil.test/repos/a/b/pulls/1',
        'https://api.github.com/repos/a/b/pulls/1?x=1',
        'https://api.github.com/repos/a/b/pulls/0',
    ])('rejects unsafe target %s', (url) =>
        expect(() => targetFromUrl(url)).toThrow()
    );
    it.each([0, 1, 20, 21, 50, 51, 150])(
        'deduplicates and batches %i targets without losing order',
        async (size) => {
            const network = fixtureTransport(size);
            const transport = vi.fn(network.transport);
            const urls = network.fixtures.map((f) => f.url);
            const result = await run(transport, [...urls, ...urls]);
            expect(transport).toHaveBeenCalledTimes(Math.ceil(size / 20));
            expect(result.details.size + result.fallbackUrls.size).toBe(size);
            expect(result.rateUsage).toHaveLength(Math.ceil(size / 20));
            expect([
                ...result.details.keys(),
                ...result.fallbackUrls,
            ]).toHaveLength(size);
        }
    );
    it.each([0, 51, 1.5])(
        'rejects invalid batch size %i before transport',
        async (batchSize) => {
            const transport = vi.fn<typeof fetch>();
            await expect(
                run(transport, [fixture.url], { batchSize })
            ).rejects.toThrow();
            expect(transport).not.toHaveBeenCalled();
        }
    );
    it.each([1, 4, 11, 13])(
        'maps every consumed canonical field for fixture %i',
        (index) => {
            const f = pairedFixture(index);
            const {
                body: _body,
                diff_url: _diff,
                patch_url: _patch,
                node_id: _node,
                comments: _comments,
                commits: _commits,
                additions: _added,
                deletions: _deleted,
                ...canonical
            } = f.detail;
            expect(mapMetadata(f.node, f.target)).toEqual(canonical);
            expect(mapMetadata(f.node, f.target).id).toBe(100000 + index);
            expect(mapMetadata(f.node, f.target).id).not.toBe(f.target.number);
        }
    );
    it.each(['OPEN', 'CLOSED', 'MERGED'])(
        'preserves %s and draft status',
        (state) => {
            const mapped = mapMetadata(
                { ...fixture.node, state, isDraft: true },
                fixture.target
            );
            expect(mapped.state).toBe(state === 'OPEN' ? 'open' : 'closed');
            expect(mapped.merged).toBe(state === 'MERGED');
            expect(mapped.draft).toBe(true);
        }
    );
    it('keeps timestamp spelling, avatar URL parameters and reviewer order visible, never normalizes them away', () => {
        const node = structuredClone(fixture.node);
        node.createdAt = '2026-01-15T10:00:00.000Z';
        node.author!.avatarUrl += '?s=40&v=4';
        node.reviewRequests.nodes.reverse();
        const mapped = mapMetadata(node, fixture.target);
        expect(mapped.created_at).not.toBe(fixture.detail.created_at);
        expect(mapped.user?.avatar_url).not.toBe(
            fixture.detail.user?.avatar_url
        );
        expect(mapped.requested_reviewers.map((r) => r.login)).toEqual(
            [
                ...fixture.detail.requested_reviewers.map((r) => r.login),
            ].reverse()
        );
    });
    it.each([
        null,
        { ...fixture.node, fullDatabaseId: null },
        { ...fixture.node, fullDatabaseId: '9007199254740993' },
        { ...fixture.node, fullDatabaseId: 'opaque-node-4' },
        { ...fixture.node, headRefOid: null },
        { ...fixture.node, baseRepository: null },
        {
            ...fixture.node,
            baseRepository: {
                ...fixture.node.baseRepository,
                name: 'wrong-repository',
            },
        },
        {
            ...fixture.node,
            repository: {
                ...fixture.node.repository,
                nameWithOwner: 'transferred/repo',
            },
        },
        { ...fixture.node, author: {} },
        { ...fixture.node, reviewRequests: null },
        {
            ...fixture.node,
            reviewRequests: {
                ...fixture.node.reviewRequests,
                pageInfo: { hasNextPage: true },
            },
        },
        {
            ...fixture.node,
            reviewRequests: { ...fixture.node.reviewRequests, totalCount: 500 },
        },
        {
            ...fixture.node,
            reviewRequests: {
                totalCount: 1,
                pageInfo: { hasNextPage: false },
                nodes: [{ requestedReviewer: null }],
            },
        },
    ])(
        'requires REST fallback for unusable canonical data (%#)',
        async (node) => {
            const result = await run(async () => response(envelope(node)));
            expect([...result.fallbackUrls]).toEqual([fixture.url]);
            expect(result.details.size).toBe(0);
        }
    );
    it('isolates alias errors and missing nodes while keeping valid aliases', async () => {
        const other = pairedFixture(2);
        const transport = vi.fn<typeof fetch>(async () =>
            response({
                data: {
                    p0: { pullRequest: fixture.node },
                    p1: { pullRequest: other.node },
                    rateLimit: rate,
                },
                errors: [{ type: 'NOT_FOUND', path: ['p1', 'pullRequest'] }],
            })
        );
        const result = await run(transport, [fixture.url, other.url]);
        expect(result.details.get(fixture.url)?.id).toBe(fixture.detail.id);
        expect([...result.fallbackUrls]).toEqual([other.url]);
        expect(transport).toHaveBeenCalledOnce();
    });
    it.each([
        {},
        { data: null },
        { data: { p0: null, rateLimit: rate } },
        { data: { p0: { pullRequest: fixture.node } } },
        { ...envelope(), errors: [{ type: 'RESOURCE_LIMITS_EXCEEDED' }] },
        { ...envelope(), errors: [{ type: 'UNKNOWN', path: ['p999'] }] },
        { ...envelope(), errors: 'malformed' },
    ])(
        'does not claim complete data for malformed/global errors (%#)',
        async (body) => {
            const result = await run(async () => response(body));
            expect(result.details.size).toBe(0);
            expect(result.fallbackUrls.has(fixture.url)).toBe(true);
        }
    );
    it.each(['network', 'json', 'http'] as const)(
        'schedules one REST fallback after %s failure, without GraphQL retry',
        async (failure) => {
            const transport = vi.fn<typeof fetch>(async () => {
                if (failure === 'network')
                    throw new TypeError('sensitive upstream message');
                return failure === 'json'
                    ? new Response('{bad')
                    : response({}, 502);
            });
            expect((await run(transport)).fallbackUrls.has(fixture.url)).toBe(
                true
            );
            expect(transport).toHaveBeenCalledOnce();
        }
    );
    it.each([401, 403])(
        'halts on HTTP %i access failures without fallback or another batch',
        async (code) => {
            const transport = vi.fn<typeof fetch>(async () =>
                response({}, code)
            );
            await expect(
                run(
                    transport,
                    fixtureTransport(21).fixtures.map((f) => f.url)
                )
            ).rejects.toMatchObject({ kind: 'access' });
            expect(transport).toHaveBeenCalledOnce();
        }
    );
    it('halts on HTTP 200 permission errors even with partial data', async () => {
        await expect(
            run(async () =>
                response({
                    ...envelope(),
                    errors: [
                        { type: 'FORBIDDEN', message: TOKEN, path: ['p0'] },
                    ],
                })
            )
        ).rejects.toMatchObject({
            kind: 'access',
            message: expect.not.stringContaining(TOKEN),
        });
    });
    it.each(['primary', 'secondary', 'http200'] as const)(
        'retains %s rate metadata and stops without fallback',
        async (kind) => {
            vi.useFakeTimers();
            vi.setSystemTime('2030-01-01T00:00:00Z');
            const transport = vi.fn<typeof fetch>(async () =>
                response(
                    {
                        errors: [
                            {
                                type: 'RATE_LIMITED',
                                message:
                                    kind === 'secondary'
                                        ? 'secondary rate limit'
                                        : 'API rate limit exceeded',
                            },
                        ],
                    },
                    kind === 'http200' ? 200 : kind === 'primary' ? 403 : 429,
                    {
                        'x-ratelimit-remaining': '0',
                        'x-ratelimit-reset': String(Date.now() / 1000 + 120),
                        'x-ratelimit-resource': 'graphql',
                        ...(kind === 'secondary'
                            ? { 'retry-after': '30' }
                            : {}),
                    }
                )
            );
            await expect(
                run(
                    transport,
                    fixtureTransport(21).fixtures.map((f) => f.url)
                )
            ).rejects.toMatchObject({
                kind: 'rate-limit',
                cooldown: {
                    resource: 'graphql',
                    classification:
                        kind === 'secondary' ? 'secondary' : 'primary',
                    nextAllowedAt:
                        Date.now() + (kind === 'secondary' ? 30000 : 120000),
                },
            });
            expect(transport).toHaveBeenCalledOnce();
        }
    );
    it('does not dispatch the next batch after successful telemetry reports zero remaining', async () => {
        vi.useFakeTimers();
        vi.setSystemTime('2030-01-01T00:00:00Z');
        const transport = vi.fn<typeof fetch>(async () =>
            response({
                data: {
                    ...envelope().data,
                    rateLimit: { ...rate, remaining: 0 },
                },
            })
        );
        await expect(
            run(transport, [fixture.url, pairedFixture(2).url], {
                batchSize: 1,
            })
        ).rejects.toBeInstanceOf(HybridMetadataError);
        expect(transport).toHaveBeenCalledOnce();
    });
    it.each(['before', 'fetch', 'text', 'generation'] as const)(
        'safely invalidates at %s boundary',
        async (boundary) => {
            const controller = new AbortController();
            let valid = true;
            const reached = deferred();
            const release = deferred();
            if (boundary === 'before') controller.abort();
            const transport = vi.fn<typeof fetch>(async (_, init) => {
                expect(init?.signal).toBe(controller.signal);
                const result = response(envelope());
                if (boundary === 'text')
                    vi.spyOn(result, 'text').mockImplementation(async () => {
                        reached.resolve();
                        await release.promise;
                        return JSON.stringify(envelope());
                    });
                else {
                    reached.resolve();
                    await release.promise;
                }
                return result;
            });
            const promise = run(
                transport,
                [fixture.url, pairedFixture(2).url],
                {
                    batchSize: 1,
                    session: {
                        signal: controller.signal,
                        isValid: () => valid,
                    },
                }
            );
            const rejected = expect(promise).rejects.toMatchObject({
                name: 'RefreshSessionInvalidatedError',
            });
            if (boundary !== 'before') {
                await reached.promise;
                if (boundary === 'generation') valid = false;
                else controller.abort();
                release.resolve();
            }
            await rejected;
            expect(transport).toHaveBeenCalledTimes(
                boundary === 'before' ? 0 : 1
            );
        }
    );
});

describe('paired current REST/hybrid refreshes and instrumentation', () => {
    it.each([5, 20, 40, 100, 150])(
        'preserves complete PR outputs and REST optional calls for %i PRs',
        async (size) => {
            const rest = await runTrial(
                fixtureTransport(size).transport,
                'rest'
            );
            const hybrid = await runTrial(
                fixtureTransport(size).transport,
                'hybrid'
            );
            expect(rest.result.status).toBe('success');
            expect(hybrid.result).toEqual(rest.result);
            expect(hybrid.metrics.totalHttpRequests).toBe(
                rest.metrics.totalHttpRequests -
                    size +
                    Math.ceil(size / 20) +
                    Math.floor(size / 37)
            );
            for (const endpoint of [
                'user',
                'search',
                'reviews',
                'check-runs',
                'status',
            ])
                expect(hybrid.metrics.endpoints[endpoint]).toBe(
                    rest.metrics.endpoints[endpoint]
                );
            expect(hybrid.metrics.fallbackRequests).toBe(Math.floor(size / 37));
            expect(hybrid.metrics.graphqlReportedPoints).toBe(
                Math.ceil(size / 20)
            );
            expect(hybrid.metrics.totalHttpRequests).toBe(
                hybrid.metrics.coreRequests +
                    hybrid.metrics.searchRequests +
                    hybrid.metrics.graphqlRequests
            );
            if (size === 40) {
                expect(
                    1 -
                        hybrid.metrics.totalHttpRequests /
                            rest.metrics.totalHttpRequests
                ).toBeGreaterThanOrEqual(0.25);
                if (hybrid.result.status === 'success')
                    expect(
                        new Set(
                            hybrid.result.pullRequests.map((pr) => pr.ci_status)
                        )
                    ).toEqual(
                        new Set([
                            'passing',
                            'failing',
                            'pending',
                            'no-ci',
                            'unknown',
                        ])
                    );
            }
        }
    );
    it.each(['partial', 'network', 'timeout'] as const)(
        'counts actual fallbacks after %s failure and preserves outputs',
        async (fault) => {
            const rest = await runTrial(fixtureTransport(5).transport, 'rest');
            const hybrid = await runTrial(
                fixtureTransport(5, { fault }).transport,
                'hybrid'
            );
            expect(hybrid.result).toEqual(rest.result);
            expect(hybrid.metrics.fallbackRequests).toBe(
                fault === 'partial' ? 1 : 5
            );
            expect(hybrid.metrics.retryRequests).toBe(0);
            expect(hybrid.metrics.graphqlRequests).toBe(1);
            if (fault === 'network') {
                expect(hybrid.metrics.failedTransports).toBe(1);
                expect(hybrid.metrics.graphqlReportedPoints).toBeNull();
            }
        }
    );
    it('fails safely when both GraphQL and required REST detail are unavailable', async () => {
        const base = fixtureTransport(5, { fault: 'partial' }).transport;
        const network: typeof fetch = async (input, init) =>
            String(input) === pairedFixture(1).url
                ? response({}, 404)
                : base(input, init);
        const hybrid = await runTrial(network, 'hybrid');
        expect(hybrid.result.status).toBe('failure');
        expect(hybrid.metrics.fallbackRequests).toBe(1);
    });
    it('propagates a GraphQL cooldown at the tooling boundary with no REST fallback', async () => {
        const trial = await runTrial(
            fixtureTransport(5, { fault: 'rate-limit' }).transport,
            'hybrid'
        );
        expect(trial.result).toMatchObject({
            status: 'failure',
            rateLimit: { resource: 'graphql' },
        });
        expect(trial.metrics.fallbackRequests).toBe(0);
        expect(trial.metrics.endpoints.reviews).toBeUndefined();
    });
    it('leaves incomplete REST discovery to production and never starts GraphQL', async () => {
        const trial = await runTrial(
            fixtureTransport(5, { fault: 'incomplete-search' }).transport,
            'hybrid'
        );
        expect(trial.result.status).toBe('failure');
        expect(trial.metrics.graphqlRequests).toBe(0);
    });
    it.each([undefined, 'is:pr org:fixture-org'])(
        'preserves stale closed/merged discovery hits for query %s',
        async (customQuery) => {
            const network = () => {
                const base = fixtureTransport(5).transport;
                const wrapped: typeof fetch = async (input, init) => {
                    const result = await base(input, init);
                    const body = await result.json();
                    if (String(input).endsWith('/graphql'))
                        for (const [key, alias] of Object.entries(body.data)) {
                            if (
                                key !== 'rateLimit' &&
                                (alias as { pullRequest: { number: number } })
                                    .pullRequest.number === 501
                            )
                                (
                                    alias as { pullRequest: { state: string } }
                                ).pullRequest.state = 'MERGED';
                        }
                    if (String(input) === pairedFixture(1).url)
                        body.state = 'closed';
                    return response(body, result.status, result.headers);
                };
                return wrapped;
            };
            const rest = await runTrial(network(), 'rest', { customQuery });
            const hybrid = await runTrial(network(), 'hybrid', { customQuery });
            expect(hybrid.result).toEqual(rest.result);
            if (hybrid.result.status === 'success')
                expect(hybrid.result.pullRequests).toHaveLength(
                    customQuery ? 5 : 4
                );
        }
    );
    it('exposes unexpected field differences rather than claiming parity', () => {
        expect(
            fieldDifferences(
                [{ id: 1, author: { login: 'a', avatar_url: 'a' } }] as never,
                [{ id: 1, author: { login: 'a', avatar_url: 'b' } }] as never
            )
        ).toEqual({ author: 1 });
    });
    it('reproduces counts and bytes without credentials or real network timings', async () => {
        const first = await benchmarkFixtures({ sizes: [5, 40], repeats: 1 });
        const second = await benchmarkFixtures({ sizes: [5, 40], repeats: 1 });
        const stable = (value: typeof first) => ({
            ...value,
            trials: value.trials.map((t) => ({
                ...t,
                rest: { ...t.rest, elapsedMs: null },
                hybrid: { ...t.hybrid, elapsedMs: null },
            })),
        });
        expect(stable(first)).toEqual(stable(second));
        expect(
            first.trials.every((t) => JSON.stringify(t.differences) === '{}')
        ).toBe(true);
        expect(JSON.stringify(first)).not.toContain(TOKEN);
    });
    it('invalidates before a REST fallback can return a late detail', async () => {
        let valid = true;
        const controller = new AbortController();
        const base = fixtureTransport(1, { fault: 'partial' }).transport;
        const network: typeof fetch = async (input, init) => {
            const result = await base(input, init);
            if (String(input) === pairedFixture(1).url) valid = false;
            return result;
        };
        const adapter = createHybridTransport({
            token: TOKEN,
            transport: network,
            session: { signal: controller.signal, isValid: () => valid },
        });
        await adapter.transport('https://api.github.com/search/issues?q=is:pr');
        await expect(
            adapter.transport(pairedFixture(1).url)
        ).rejects.toMatchObject({ name: 'RefreshSessionInvalidatedError' });
        expect(adapter.fallbackRequests).toBe(1);
    });
});

it('diagnoses canonical avatar differences using fixtures, without storing PR data or credentials', async () => {
    const base = fixtureTransport(40).transport;
    const network: typeof fetch = async (input, init) => {
        if (String(input).endsWith('/rate_limit'))
            return response({
                resources: {
                    core: { remaining: 5000 },
                    graphql: { remaining: 5000 },
                    search: { remaining: 30 },
                },
            });
        const result = await base(input, init);
        if (!String(input).endsWith('/graphql')) return result;
        const body = await result.json();
        for (const [key, value] of Object.entries(body.data)) {
            if (key === 'rateLimit') continue;
            const alias = value as {
                pullRequest: ReturnType<typeof pairedFixture>['node'];
            };
            if (alias.pullRequest.number === 504) {
                alias.pullRequest.author!.avatarUrl += '?s=40';
                const reviewer =
                    alias.pullRequest.reviewRequests.nodes[0]!
                        .requestedReviewer;
                if ('avatarUrl' in reviewer) reviewer.avatarUrl += '?s=40';
            }
        }
        return response(body);
    };
    vi.stubGlobal('fetch', network);
    const result = await diagnoseLiveMetadata(TOKEN);
    expect(result.fields).toEqual({
        user: 1,
        requested_reviewers: 1,
        fallbackRequired: 1,
    });
    expect(result.reviewer).toMatchObject({
        changedArrays: 1,
        avatarOnly: 1,
        sameLoginsSameOrder: 1,
    });
    expect(result.avatarParameterKeys).toEqual(['s']);
    expect(JSON.stringify(result)).not.toMatch(
        /only-a-test-token|fixture-author|reviewer-0|Synthetic pull/
    );
});

it('reports raw REST reviewer attributes as an explicit difference instead of normalizing a paired result', async () => {
    const base = fixtureTransport(1).transport;
    const network: typeof fetch = async (input, init) => {
        const result = await base(input, init);
        if (String(input) !== pairedFixture(1).url) return result;
        const body = await result.json();
        body.requested_reviewers[0].id = 123;
        return response(body, result.status, result.headers);
    };
    const rest = await runTrial(network, 'rest');
    const hybrid = await runTrial(network, 'hybrid');
    if (rest.result.status !== 'success' || hybrid.result.status !== 'success')
        throw new Error('Unusable paired trial');
    expect(
        fieldDifferences(rest.result.pullRequests, hybrid.result.pullRequests)
    ).toEqual({ requested_reviewers: 1 });
    expect(hybrid.result.pullRequests[0]!.requested_reviewers[0]).toEqual(
        rest.result.pullRequests[0]!.requested_reviewers.map(
            ({ login, avatar_url }) => ({ login, avatar_url })
        )[0]
    );
});

it('preserves custom-query 100-item discovery pagination and rejects an incomplete later page before hydration', async () => {
    const query = 'is:pr org:fixture-org';
    const rest = await runTrial(fixtureTransport(150).transport, 'rest', {
        customQuery: query,
    });
    const hybrid = await runTrial(fixtureTransport(150).transport, 'hybrid', {
        customQuery: query,
    });
    expect(hybrid.result).toEqual(rest.result);
    expect(hybrid.metrics.searchRequests).toBe(2);
    const base = fixtureTransport(150).transport;
    const network: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/search/issues') {
            expect(url.searchParams.get('per_page')).toBe('100');
            expect(url.searchParams.get('q')).toBe(query);
            if (url.searchParams.get('page') === '2')
                return response({
                    total_count: 150,
                    incomplete_results: true,
                    items: [],
                });
        }
        return base(input, init);
    };
    const failed = await runTrial(network, 'hybrid', { customQuery: query });
    expect(failed.result.status).toBe('failure');
    expect(failed.metrics.graphqlRequests).toBe(0);
});

it('pins unchanged REST CI to the base repository and current SHA across later commits', async () => {
    const urls: string[] = [];
    const network = (later: boolean): typeof fetch => {
        const base = fixtureTransport(1).transport;
        return async (input, init) => {
            const url = String(input);
            const sha = later
                ? 'f'.repeat(40)
                : pairedFixture(1).detail.head.sha;
            if (new URL(url).pathname.endsWith('/check-runs')) {
                urls.push(url);
                expect(url).toContain(
                    `/repos/fixture-org/service-1/commits/${sha}/check-runs`
                );
                expect(url).not.toContain('/fixture-fork/');
                return response({
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
            const result = await base(input, init);
            const body = await result.json();
            if (url === pairedFixture(1).url) body.head.sha = sha;
            if (url.endsWith('/graphql'))
                body.data.p0.pullRequest.headRefOid = sha;
            return response(body, result.status, result.headers);
        };
    };
    for (const later of [false, true]) {
        const rest = await runTrial(network(later), 'rest');
        const hybrid = await runTrial(network(later), 'hybrid');
        expect(hybrid.result).toEqual(rest.result);
        if (hybrid.result.status === 'success')
            expect(hybrid.result.pullRequests[0]!.ci_status).toBe(
                later ? 'pending' : 'passing'
            );
    }
    expect(urls).toHaveLength(4);
});

it('does not issue identity or metadata requests for an already invalid session', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn<typeof fetch>();
    await expect(
        runTrial(transport, 'hybrid', {
            session: { signal: controller.signal, isValid: () => true },
        })
    ).rejects.toMatchObject({ name: 'RefreshSessionInvalidatedError' });
    expect(transport).not.toHaveBeenCalled();
});
it('retains a reviewed-only PR with no outstanding reviewer or team requests', async () => {
    const f = pairedFixture(9);
    const node = {
        ...f.node,
        reviewRequests: {
            totalCount: 0,
            pageInfo: { hasNextPage: false },
            nodes: [],
        },
    };
    expect(mapMetadata(node, f.target).requested_reviewers).toEqual([]);
    const hybrid = await runTrial(fixtureTransport(9).transport, 'hybrid');
    if (hybrid.result.status !== 'success')
        throw new Error('Incomplete fixture');
    expect(
        hybrid.result.pullRequests.find((pr) => pr.id === f.detail.id)
            ?.discoverySources
    ).toEqual(['reviewed']);
    expect(
        hybrid.result.pullRequests.find((pr) => pr.id === f.detail.id)
            ?.requested_reviewers
    ).toEqual([]);
});
