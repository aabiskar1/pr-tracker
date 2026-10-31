import { assertRefreshSessionValid } from '../../background/refreshSession';
import { fetchPullRequests } from '../../background/api';
import { instrumentTransport } from '../githubGraphql/measurement';
import { createHybridTransport } from './transport';
import { consumedPullRequests, canonicalDifferences } from './compatibility';
import type { MetadataOptions, CanonicalDetail } from './client';
import { fixtureTransport, type Fault } from './fixtures';
import type { PullRequest } from '../../types';

export function fieldDifferences(rest: PullRequest[], hybrid: PullRequest[]) {
    const differences: Record<string, number> = {};
    const byId = new Map(hybrid.map((pr) => [pr.id, pr]));
    for (const pr of rest) {
        const other = byId.get(pr.id);
        if (!other) {
            differences.missing = (differences.missing ?? 0) + 1;
            continue;
        }
        for (const field of Object.keys(pr) as (keyof PullRequest)[])
            if (JSON.stringify(pr[field]) !== JSON.stringify(other[field]))
                differences[field] = (differences[field] ?? 0) + 1;
    }
    const extra = hybrid.filter(
        (pr) => !rest.some((r) => r.id === pr.id)
    ).length;
    if (extra) differences.extra = extra;
    return differences;
}
// Serial tooling runner: global fetch is swapped only to execute the REAL production
// fetcher, then always restored. This is never imported by a production entrypoint.
export async function runTrial(
    network: typeof fetch,
    client: 'rest' | 'hybrid',
    options: {
        customQuery?: string;
        batchSize?: number;
        session?: MetadataOptions['session'];
    } = {}
) {
    const costs: (number | null)[] = [];
    const canonicalDetails = new Map<string, CanonicalDetail>();
    const attempts = { core: 0, search: 0, graphql: 0 };
    const checkTargets = new Set<string>();
    const reviewTargets = new Set<string>();
    let checkRequests = 0;
    let reviewRequests = 0;
    const observed: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/check-runs')) {
            checkRequests++;
            checkTargets.add(path);
        }
        if (path.endsWith('/reviews')) {
            reviewRequests++;
            reviewTargets.add(path);
        }
        attempts[
            path === '/graphql'
                ? 'graphql'
                : path === '/search/issues'
                  ? 'search'
                  : 'core'
        ]++;
        const response = await network(input, init);
        if (String(input) === 'https://api.github.com/graphql') {
            try {
                const body = await response.clone().json();
                costs.push(
                    typeof body?.data?.rateLimit?.cost === 'number'
                        ? body.data.rateLimit.cost
                        : null
                );
            } catch {
                costs.push(null);
            }
        }
        return response;
    };
    const measured = instrumentTransport(observed, 2000);
    const adapter = createHybridTransport({
        token: 'fixture-token-overridden-in-live',
        transport: measured.transport,
        batchSize: options.batchSize,
        session: options.session,
    });
    // In a live run a credential-injecting network wrapper replaces this placeholder.
    const original = globalThis.fetch;
    const log = console.log;
    const error = console.error;
    const start = performance.now();
    try {
        console.log = () => undefined;
        console.error = () => undefined;
        assertRefreshSessionValid(options.session);
        const identity = await measured.transport(
            'https://api.github.com/user',
            { signal: options.session?.signal }
        );
        assertRefreshSessionValid(options.session);
        if (!identity.ok) throw new Error('Benchmark identity failed');
        const user = await identity.json();
        assertRefreshSessionValid(options.session);
        const detailTransport =
            client === 'rest' ? measured.transport : adapter.transport;
        globalThis.fetch = async (input, init) => {
            const response = await detailTransport(input, init);
            if (
                /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(
                    new URL(String(input)).pathname
                ) &&
                response.ok
            ) {
                const detail = await response.clone().json();
                assertRefreshSessionValid(options.session);
                canonicalDetails.set(String(input), detail);
            }
            return response;
        };
        let result = await fetchPullRequests(
            'fixture-token-overridden-in-live',
            user,
            options.customQuery,
            async () => undefined,
            options.session
        );
        // Tooling-level propagation only. Production has not gained a GraphQL adapter.
        if (result.status === 'failure' && adapter.failure?.cooldown)
            result = { ...result, rateLimit: adapter.failure.cooldown };
        const elapsedMs = performance.now() - start;
        const endpoints: Record<string, number> = {};
        for (const request of measured.requests)
            endpoints[request.endpoint] =
                (endpoints[request.endpoint] ?? 0) + 1;
        return {
            metrics: {
                client,
                elapsedMs,
                outcome: result.status,
                totalHttpRequests: measured.attemptedRequests,
                completedResponses: measured.requests.length,
                coreRequests: attempts.core,
                searchRequests: attempts.search,
                graphqlRequests: attempts.graphql,
                decodedBodyBytes: measured.requests.reduce(
                    (sum, r) => sum + r.bodyBytes,
                    0
                ),
                // Fixture consumption equals counted requests; live budget deltas are
                // collected separately. Never add core/search units to GraphQL points.
                graphqlReportedPoints:
                    costs.length !== attempts.graphql ||
                    costs.some((cost) => cost === null)
                        ? null
                        : costs.reduce<number>(
                              (sum, cost) => sum + (cost ?? 0),
                              0
                          ),
                fallbackRequests: adapter.fallbackRequests,
                metadataFallbackReasons: adapter.metadataFallbackReasons,
                additionalCIPaginationRequests:
                    checkRequests - checkTargets.size,
                additionalReviewPaginationRequests:
                    reviewRequests - reviewTargets.size,
                combinedStatusFallbackRequests: endpoints.status ?? 0,
                metadataFailure: adapter.failure?.kind ?? null,
                endpoints,
                failedResponses: measured.requests.filter(
                    (r) => r.status >= 400
                ).length,
                failedTransports:
                    measured.attemptedRequests - measured.requests.length,
                retryRequests: 0,
            },
            result,
            canonicalDetails,
        };
    } finally {
        globalThis.fetch = original;
        console.log = log;
        console.error = error;
    }
}
export async function benchmarkFixtures(
    options: {
        repeats?: number;
        restDelayMs?: number;
        graphqlDelayMs?: number;
        sizes?: number[];
        fault?: Fault;
        batchSize?: number;
    } = {}
) {
    const trials = [];
    for (const size of options.sizes ?? [5, 20, 40, 100, 150])
        for (let repeat = 0; repeat < (options.repeats ?? 3); repeat++) {
            const outputs: Partial<
                Record<'rest' | 'hybrid', Awaited<ReturnType<typeof runTrial>>>
            > = {};
            for (const client of repeat % 2
                ? (['hybrid', 'rest'] as const)
                : (['rest', 'hybrid'] as const)) {
                outputs[client] = await runTrial(
                    fixtureTransport(size, options).transport,
                    client,
                    { batchSize: options.batchSize }
                );
            }
            const rest = outputs.rest!;
            const hybrid = outputs.hybrid!;
            trials.push({
                size,
                repeat,
                rest: rest.metrics,
                hybrid: hybrid.metrics,
                canonicalDifferences:
                    rest.result.status === 'success' &&
                    hybrid.result.status === 'success'
                        ? canonicalDifferences(
                              rest.canonicalDetails,
                              hybrid.canonicalDetails
                          )
                        : null,
                consumedDifferences:
                    rest.result.status === 'success' &&
                    hybrid.result.status === 'success'
                        ? fieldDifferences(
                              consumedPullRequests(rest.result.pullRequests),
                              consumedPullRequests(hybrid.result.pullRequests)
                          )
                        : null,
                differences:
                    rest.result.status === 'success' &&
                    hybrid.result.status === 'success'
                        ? fieldDifferences(
                              rest.result.pullRequests,
                              hybrid.result.pullRequests
                          )
                        : null,
            });
        }
    return {
        kind: 'deterministic-fixture-traffic-with-local-synthetic-delay',
        assumptions: {
            restDelayMs: options.restDelayMs ?? 0,
            graphqlDelayMs: options.graphqlDelayMs ?? 0,
            graphqlFixturePointsPerBatch: 1,
            discovery: 'production three-source REST searches',
            concurrency:
                'production four PR workers, then reviews/checks in parallel; metadata batches sequential upfront',
        },
        trials,
    };
}
