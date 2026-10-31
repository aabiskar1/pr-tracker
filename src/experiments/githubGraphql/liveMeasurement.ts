import { fetchPullRequests } from '../../background/api';
import { investigateGraphql } from './client';
import { instrumentTransport } from './measurement';
import type { PullRequest } from '../../types';

type Budget = { used: number; remaining: number; reset: number };
type Budgets = Record<'core' | 'search' | 'graphql', Budget>;

async function budgets(token: string): Promise<Budgets> {
    const response = await fetch('https://api.github.com/rate_limit', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Cannot inspect measurement budgets');
    return (await response.json()).resources;
}

function differences(rest: PullRequest[], graph: PullRequest[]) {
    const graphById = new Map(graph.map((pr) => [pr.id, pr]));
    const fields: Record<string, number> = {};
    for (const pr of rest) {
        const other = graphById.get(pr.id);
        if (!other) {
            fields.missingInGraphql = (fields.missingInGraphql ?? 0) + 1;
            continue;
        }
        for (const field of Object.keys(pr) as (keyof PullRequest)[]) {
            if (JSON.stringify(pr[field]) !== JSON.stringify(other[field]))
                fields[field] = (fields[field] ?? 0) + 1;
        }
    }
    const restIds = new Set(rest.map((pr) => pr.id));
    fields.extraInGraphql = graph.filter((pr) => !restIds.has(pr.id)).length;
    return fields;
}

export async function measureLive(token: string) {
    const trials = [];
    // Public repository only; report aggregate metrics, never PR payloads.
    const workloads = [
        {
            name: 'repository-open',
            query: 'repo:aabiskar1/pr-tracker is:pr is:open sort:created-asc',
            repeats: 3,
        },
        {
            name: 'repository-history',
            query: 'repo:aabiskar1/pr-tracker is:pr sort:created-asc',
            repeats: 1,
        },
    ];
    for (const workload of workloads) {
        for (let repeat = 0; repeat < workload.repeats; repeat++) {
            const results: Partial<Record<'rest' | 'graphql', PullRequest[]>> =
                {};
            // Alternate order for the small repeated sample. No cold-cache claim.
            const order =
                repeat % 2
                    ? (['graphql', 'rest'] as const)
                    : (['rest', 'graphql'] as const);
            for (const client of order) {
                const before = await budgets(token);
                if (
                    before.core.remaining < 600 ||
                    before.graphql.remaining < 100 ||
                    before.search.remaining < 5
                )
                    throw new Error(
                        'Insufficient remaining budget for controlled measurement'
                    );
                const measured = instrumentTransport(fetch);
                const start = performance.now();
                const userResponse = await measured.transport(
                    'https://api.github.com/user',
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                if (!userResponse.ok)
                    throw new Error('Measurement identity request failed');
                const user = await userResponse.json();
                let pullRequests: PullRequest[];
                let graphqlCost: number | null = null;
                if (client === 'rest') {
                    const network = globalThis.fetch;
                    try {
                        globalThis.fetch = measured.transport;
                        const result = await fetchPullRequests(
                            token,
                            user,
                            workload.query,
                            async () => undefined
                        );
                        if (result.status !== 'success' || result.rateLimit)
                            throw new Error(
                                'REST measurement was incomplete or rate limited'
                            );
                        pullRequests = result.pullRequests;
                    } finally {
                        globalThis.fetch = network;
                    }
                } else {
                    const result = await investigateGraphql({
                        token,
                        login: user.login,
                        customQuery: workload.query,
                        transport: measured.transport,
                    });
                    if (result.truncated)
                        throw new Error('GraphQL measurement was truncated');
                    pullRequests = result.pullRequests;
                    graphqlCost = result.rateLimits.reduce(
                        (sum, rate) => sum + rate.cost,
                        0
                    );
                }
                if (measured.attemptedRequests !== measured.requests.length) {
                    throw new Error(
                        'Measurement transport failed; discard incomplete trial'
                    );
                }
                const elapsedMs = performance.now() - start;
                const after = await budgets(token);
                const observedBudgetDelta = Object.fromEntries(
                    (['core', 'search', 'graphql'] as const).map((resource) => [
                        resource,
                        before[resource].reset === after[resource].reset
                            ? after[resource].used - before[resource].used
                            : null,
                    ])
                );
                results[client] = pullRequests;
                trials.push({
                    workload: workload.name,
                    repeat: repeat + 1,
                    client,
                    pullRequests: pullRequests.length,
                    elapsedMs,
                    httpRequests: measured.requests.length,
                    decodedBodyBytes: measured.requests.reduce(
                        (sum, r) => sum + r.bodyBytes,
                        0
                    ),
                    graphqlCost,
                    budgetBefore: before,
                    budgetAfter: after,
                    observedBudgetDelta,
                    requests: measured.requests,
                });
            }
            trials.push({
                workload: workload.name,
                repeat: repeat + 1,
                differences: differences(results.rest!, results.graphql!),
            });
        }
    }
    return {
        measuredAt: new Date().toISOString(),
        scope: 'Public aabiskar1/pr-tracker repository; custom-query fetch plus identity, excluding browser storage/UI/notifications and two budget probes per trial',
        trials,
    };
}
