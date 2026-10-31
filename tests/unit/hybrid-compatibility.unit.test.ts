import { describe, expect, it, vi, afterEach } from 'vitest';
import {
    fetchMetadata,
    metadataQuery,
    mapMetadata,
} from '../../src/experiments/hybridMetadata/client';
import {
    discoveryAuthor,
    preserveRestAuthor,
    consumedPullRequests,
    canonicalDifferences,
} from '../../src/experiments/hybridMetadata/compatibility';
import {
    fixtureTransport,
    pairedFixture,
} from '../../src/experiments/hybridMetadata/fixtures';
import {
    runTrial,
    fieldDifferences,
} from '../../src/experiments/hybridMetadata/benchmark';
import { benchmarkLive } from '../../src/experiments/hybridMetadata/live';
vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));
afterEach(() => vi.unstubAllGlobals());
const f = pairedFixture(1);
const evidence = () =>
    discoveryAuthor({
        ...f.detail,
        user: { ...f.detail.user, node_id: f.node.author!.id, type: 'User' },
    })!;
const response = (data: unknown) => Response.json(data);

describe('verified REST discovery author compatibility', () => {
    it('queries global actor IDs without requesting an image size', () => {
        const query = metadataQuery([f.target]).query;
        expect(query).toContain('... on User { id }');
        expect(query).toContain('... on Bot { id }');
        expect(query).not.toContain('avatarUrl(');
    });
    it('uses global PR identity when REST search issue IDs differ from canonical PR IDs', () => {
        const proof = evidence();
        proof.id = f.detail.id + 500000;
        expect(
            preserveRestAuthor(mapMetadata(f.node, f.target), f.node, proof).id
        ).toBe(f.detail.id);
    });
    it('preserves the exact REST representation even when opaque parameters differ', () => {
        const node = {
            ...f.node,
            author: {
                ...f.node.author!,
                avatarUrl: 'https://avatars.example/author.png?u=opaque&v=4',
            },
        };
        const proof = evidence();
        proof.user!.avatar_url = 'https://avatars.example/author.png?v=4';
        const detail = preserveRestAuthor(
            mapMetadata(node, f.target),
            node,
            proof
        );
        expect(detail.user).toEqual({
            login: proof.user!.login,
            avatar_url: proof.user!.avatar_url,
        });
        expect(node.author.avatarUrl).toContain('u=opaque');
    });
    it.each([
        'pr-node-id',
        'updated_at',
        'node_id',
        'login',
        'type',
        'avatar_url',
        'missing-user',
        'missing-node-id',
        'null-user',
    ])(
        'falls back once for %s evidence rather than accepting an ambiguous author',
        async (fault) => {
            const base = fixtureTransport(1).transport;
            const network: typeof fetch = async (input, init) => {
                const result = await base(input, init);
                if (new URL(String(input)).pathname !== '/search/issues')
                    return result;
                const body = await result.json();
                for (const item of body.items) {
                    if (fault === 'pr-node-id') item.node_id = 'wrong-pr';
                    if (fault === 'updated_at')
                        item.updated_at = '2020-01-01T00:00:00Z';
                    if (fault === 'node_id')
                        item.user.node_id = 'different-account';
                    if (fault === 'login') item.user.login = 'renamed-or-stale';
                    if (fault === 'type') item.user.type = 'Organization';
                    if (fault === 'avatar_url')
                        item.user.avatar_url = 'invalid';
                    if (fault === 'missing-user') delete item.user;
                    if (fault === 'missing-node-id') delete item.user.node_id;
                    if (fault === 'null-user') item.user = null;
                }
                return response(body);
            };
            const rest = await runTrial(network, 'rest');
            const hybrid = await runTrial(network, 'hybrid');
            expect(hybrid.result).toEqual(rest.result);
            expect(hybrid.metrics.fallbackRequests).toBe(1);
            expect(hybrid.metrics.totalHttpRequests).toBe(
                rest.metrics.totalHttpRequests + 1
            );
        }
    );
    it.each(['id', '__typename', 'login'])(
        'rejects conflicting GraphQL author %s',
        async (key) => {
            const node = structuredClone(f.node);
            Object.assign(node.author!, { [key]: 'different' });
            const result = await fetchMetadata([f.url], {
                token: 'fixture',
                transport: async () =>
                    response({
                        data: {
                            p0: { pullRequest: node },
                            rateLimit: {
                                cost: 1,
                                remaining: 100,
                                resetAt: '2030-01-01T00:00:00Z',
                            },
                        },
                    }),
                discoveryAuthors: new Map([[f.url, evidence()]]),
            });
            expect([...result.fallbackUrls]).toEqual([f.url]);
            expect(result.details.size).toBe(0);
        }
    );
    it('requires evidence when compatibility mode is enabled', async () => {
        const result = await fetchMetadata([f.url], {
            token: 'fixture',
            transport: fixtureTransport(1).transport,
            discoveryAuthors: new Map(),
        });
        expect(result.details.size).toBe(0);
        expect([...result.fallbackUrls]).toEqual([f.url]);
    });
    it('keeps conflicts across discovery sources ambiguous even after another valid observation', async () => {
        let searches = 0;
        const base = fixtureTransport(1).transport;
        const network: typeof fetch = async (input, init) => {
            const result = await base(input, init);
            if (new URL(String(input)).pathname !== '/search/issues')
                return result;
            const observation = ++searches;
            const body = await result.json();
            // Force all three source streams to observe the same PR.
            body.items = [
                {
                    ...f.detail,
                    user: {
                        ...f.detail.user,
                        node_id: f.node.author!.id,
                        type: 'User',
                    },
                    pull_request: { url: f.url },
                },
            ];
            body.total_count = 1;
            if (observation === 2) body.items[0].user.avatar_url += '?stale=1';
            return response(body);
        };
        const trial = await runTrial(network, 'hybrid');
        expect(trial.result.status).toBe('success');
        expect(trial.metrics.fallbackRequests).toBe(1);
    });
    it('accepts only explicit, matching null authors', () => {
        const p = pairedFixture(13);
        const proof = discoveryAuthor(p.detail);
        expect(
            preserveRestAuthor(mapMetadata(p.node, p.target), p.node, proof)
                .user
        ).toBeNull();
        expect(() =>
            preserveRestAuthor(
                mapMetadata(p.node, p.target),
                p.node,
                evidence()
            )
        ).toThrow();
        expect(() =>
            preserveRestAuthor(mapMetadata(f.node, f.target), f.node, {
                ...evidence(),
                user: null,
            })
        ).toThrow();
    });
    it('supports a strictly matched bot and rejects unsupported author types', () => {
        const proof = evidence();
        proof.user!.type = 'Bot';
        const node = {
            ...f.node,
            author: { ...f.node.author!, __typename: 'Bot' },
        };
        expect(
            preserveRestAuthor(mapMetadata(node, f.target), node, proof).user
        ).toEqual(f.detail.user);
        for (const type of [
            'Mannequin',
            'Organization',
            'EnterpriseUserAccount',
        ])
            expect(() =>
                preserveRestAuthor(
                    mapMetadata(node, f.target),
                    { ...node, author: { ...node.author, __typename: type } },
                    proof
                )
            ).toThrow();
    });
    it('does not add detail requests for ordinary current discovery evidence', async () => {
        const trial = await runTrial(fixtureTransport(20).transport, 'hybrid');
        expect(trial.metrics.fallbackRequests).toBe(0);
        expect(trial.metrics.graphqlRequests).toBe(1);
        expect(trial.canonicalDetails.size).toBe(20);
    });
});

describe('explicit consumed reviewer compatibility and canonical diagnostics', () => {
    it('reports raw extra attributes while preserving meaningful identity, avatars and order', async () => {
        const base = fixtureTransport(4).transport;
        const network: typeof fetch = async (input, init) => {
            const result = await base(input, init);
            if (String(input) !== pairedFixture(4).url) return result;
            const body = await result.json();
            for (const reviewer of body.requested_reviewers)
                Object.assign(reviewer, { id: 123, site_admin: false });
            return response(body);
        };
        const rest = await runTrial(network, 'rest');
        const hybrid = await runTrial(network, 'hybrid');
        if (
            rest.result.status !== 'success' ||
            hybrid.result.status !== 'success'
        )
            throw new Error('Invalid pair');
        expect(
            fieldDifferences(
                rest.result.pullRequests,
                hybrid.result.pullRequests
            )
        ).toEqual({ requested_reviewers: 1 });
        expect(
            fieldDifferences(
                consumedPullRequests(rest.result.pullRequests),
                consumedPullRequests(hybrid.result.pullRequests)
            )
        ).toEqual({});
        expect(
            canonicalDifferences(rest.canonicalDetails, hybrid.canonicalDetails)
        ).toEqual({});
        const changed = structuredClone(hybrid.result.pullRequests);
        changed.find((pr) => pr.id === 100004)!.requested_reviewers.reverse();
        expect(
            fieldDifferences(
                consumedPullRequests(rest.result.pullRequests),
                consumedPullRequests(changed)
            )
        ).toEqual({ requested_reviewers: 1 });
        changed.find(
            (pr) => pr.id === 100004
        )!.requested_reviewers[0]!.avatar_url += '?s=50';
        expect(
            fieldDifferences(
                consumedPullRequests(rest.result.pullRequests),
                consumedPullRequests(changed)
            )
        ).toEqual({ requested_reviewers: 1 });
    });
    it.each(['User', 'Bot', 'Mannequin'])(
        'maps User reviewer fields and falls back for unverified %s representations',
        (type) => {
            const p = pairedFixture(4);
            const node = structuredClone(p.node);
            node.reviewRequests.nodes[0]!.requestedReviewer.__typename = type;
            if (type !== 'User') {
                expect(() => mapMetadata(node, p.target)).toThrow(
                    'Unsupported reviewer representation'
                );
                return;
            }
            const detail = mapMetadata(node, p.target);
            expect(detail.requested_reviewers).toEqual(
                p.detail.requested_reviewers
            );
            expect(detail.requested_teams).toEqual([{ slug: 'maintainers' }]);
        }
    );
    it.each([
        null,
        {},
        { __typename: 'User', login: 'hidden' },
        { __typename: 'UnknownActor' },
    ])('rejects inaccessible or malformed reviewer nodes %j', (reviewer) => {
        const node = structuredClone(f.node);
        Object.assign(node.reviewRequests.nodes[0]!, {
            requestedReviewer: reviewer,
        });
        expect(() => mapMetadata(node, f.target)).toThrow();
    });
    it.each(['id', 'head', 'base', 'updated_at', 'state', 'draft', 'number'])(
        'keeps canonical %s mismatches visible',
        (field) => {
            const detail = mapMetadata(f.node, f.target);
            const other = structuredClone(detail);
            Object.assign(other, { [field]: null });
            // Use a scalar mutation for nested fields so projection remains valid.
            if (field === 'head')
                other.head = { ...detail.head, sha: 'f'.repeat(40) };
            if (field === 'base')
                other.base = {
                    repo: {
                        ...detail.base.repo,
                        full_name: 'transferred/repo',
                    },
                };
            expect(
                canonicalDifferences(
                    new Map([[f.url, detail]]),
                    new Map([[f.url, other]])
                )
            ).toEqual({ [field]: 1 });
        }
    );
    it('does not hide missing, extra or duplicate identity effects in canonical comparisons', () => {
        const detail = mapMetadata(f.node, f.target);
        expect(
            canonicalDifferences(
                new Map([[f.url, detail]]),
                new Map([['other', detail]])
            )
        ).toEqual({ missing: 1, extra: 1 });
    });
    it('supports open public fixed-membership live trials with strict fixture evidence and no secret artifacts', async () => {
        const base = fixtureTransport(5).transport;
        let openQuery = false;
        const network: typeof fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.pathname === '/rate_limit')
                return response({
                    resources: Object.fromEntries(
                        ['core', 'search', 'graphql'].map((resource) => [
                            resource,
                            { used: 0, remaining: 5000, reset: 2000000000 },
                        ])
                    ),
                });
            if (url.pathname === '/search/issues')
                openQuery = url.searchParams.get('q')!.includes('is:open');
            return base(input, init);
        };
        vi.stubGlobal('fetch', network);
        const result = await benchmarkLive('only-test-credential', {
            sizes: [5],
            repeats: 1,
            open: true,
        });
        expect(openQuery).toBe(true);
        expect(result.population).toBe('open');
        expect(result.trials[0]!.consumedDifferences).toEqual({});
        expect(result.trials[0]!.canonicalDifferences).toEqual({});
        expect(
            result.trials[0]!.measurements.find((m) => m.client === 'hybrid')!
                .fallbackRequests
        ).toBe(0);
        expect(JSON.stringify(result)).not.toMatch(
            /only-test-credential|reviewer-0|Synthetic pull|author-node/
        );
    });
});

it.each([
    'null-reviewer',
    'duplicate-reviewer',
    'incomplete-connection',
    'bot-reviewer',
    'mannequin-reviewer',
    'enterprise-team',
])('retains a PR through REST fallback for %s', async (fault) => {
    const base = fixtureTransport(1).transport;
    const network: typeof fetch = async (input, init) => {
        const result = await base(input, init);
        if (new URL(String(input)).pathname !== '/graphql') return result;
        const body = await result.json();
        const requests = body.data.p0.pullRequest.reviewRequests;
        if (fault === 'bot-reviewer')
            requests.nodes[0].requestedReviewer.__typename = 'Bot';
        if (fault === 'mannequin-reviewer')
            requests.nodes[0].requestedReviewer.__typename = 'Mannequin';
        if (fault === 'enterprise-team')
            requests.nodes[0].requestedReviewer = {
                __typename: 'EnterpriseTeam',
            };
        if (fault === 'null-reviewer')
            requests.nodes[0].requestedReviewer = null;
        if (fault === 'duplicate-reviewer') {
            requests.nodes.unshift(requests.nodes[0]);
            requests.totalCount++;
        }
        if (fault === 'incomplete-connection')
            requests.pageInfo.hasNextPage = true;
        return Response.json(body);
    };
    const rest = await runTrial(network, 'rest');
    const hybrid = await runTrial(network, 'hybrid');
    expect(hybrid.result).toEqual(rest.result);
    expect(hybrid.metrics.fallbackRequests).toBe(1);
    expect(Object.values(hybrid.metrics.metadataFallbackReasons)).toEqual([1]);
});
