import { runTrial, fieldDifferences } from './benchmark';
import type { PullRequest } from '../../types';

type Budgets = Record<
    'core' | 'search' | 'graphql',
    { used: number; remaining: number; reset: number }
>;
export async function benchmarkLive(
    token: string,
    options: { sizes?: number[]; repeats?: number } = {}
) {
    const sizes = options.sizes ?? [40];
    if (sizes.some((size) => ![5, 20, 40, 100, 150].includes(size)))
        throw new Error('Unsupported live size');
    const native = globalThis.fetch;
    let overheadHttpRequests = 0;
    const network: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.origin !== 'https://api.github.com')
            throw new Error('Unexpected live host');
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        headers.set('Accept', 'application/vnd.github+json');
        return native(input, { ...init, headers });
    };
    const budgets = async (): Promise<Budgets> => {
        overheadHttpRequests++;
        const result = await network('https://api.github.com/rate_limit');
        if (!result.ok) throw new Error('Cannot inspect live budget');
        return (await result.json()).resources;
    };
    const before = await budgets();
    if (
        before.core.remaining < 800 ||
        before.graphql.remaining < 300 ||
        before.search.remaining < 5
    )
        throw new Error('Insufficient live budget');
    // Public, fixed membership selected ONCE. Replaying these search bodies isolates
    // metadata differences from search-index drift. This is explicitly NOT an
    // end-to-end live default discovery benchmark.
    const pool: { pull_request: { url: string } }[] = [];
    const maximum = Math.max(...sizes);
    for (let page = 1; pool.length < maximum; page++) {
        overheadHttpRequests++;
        const result = await network(
            `https://api.github.com/search/issues?q=${encodeURIComponent('repo:cli/cli is:pr sort:created-asc')}&per_page=100&page=${page}`
        );
        if (!result.ok) throw new Error('Live membership discovery failed');
        const body = await result.json();
        if (
            body.incomplete_results ||
            !Array.isArray(body.items) ||
            !body.items.length
        )
            throw new Error('Live membership incomplete');
        pool.push(
            ...body.items.map((item: { pull_request: { url: string } }) => ({
                pull_request: { url: item.pull_request.url },
            }))
        );
        if (page > 2) throw new Error('Live discovery page ceiling');
    }
    const trials = [];
    for (const size of sizes)
        for (let repeat = 0; repeat < (options.repeats ?? 2); repeat++) {
            const outputs: Partial<
                Record<'rest' | 'hybrid', Awaited<ReturnType<typeof runTrial>>>
            > = {};
            const measured = [];
            for (const client of repeat % 2
                ? (['hybrid', 'rest'] as const)
                : (['rest', 'hybrid'] as const)) {
                const budgetBefore = await budgets();
                if (
                    budgetBefore.core.remaining < size * 5 + 100 ||
                    budgetBefore.graphql.remaining < 100
                )
                    throw new Error('Live budget guard stopped run');
                let replayedDiscoveryRequests = 0;
                let replayedDiscoveryBytes = 0;
                const fixedMembership: typeof fetch = async (input, init) => {
                    const url = new URL(String(input));
                    if (url.pathname === '/search/issues') {
                        replayedDiscoveryRequests++;
                        const page = Number(url.searchParams.get('page'));
                        const body = JSON.stringify({
                            total_count: size,
                            incomplete_results: false,
                            items: pool.slice(
                                (page - 1) * 100,
                                Math.min(size, page * 100)
                            ),
                        });
                        replayedDiscoveryBytes += new TextEncoder().encode(
                            body
                        ).byteLength;
                        return new Response(body, {
                            headers: {
                                'x-ratelimit-resource': 'replayed-search',
                                'Content-Type': 'application/json',
                            },
                        });
                    }
                    return network(input, init);
                };
                const trial = await runTrial(fixedMembership, client, {
                    customQuery: 'repo:cli/cli is:pr sort:created-asc',
                });
                outputs[client] = trial;
                const budgetAfter = await budgets();
                measured.push({
                    ...trial.metrics,
                    actualHttpRequests:
                        trial.metrics.totalHttpRequests -
                        replayedDiscoveryRequests,
                    actualDecodedBodyBytes:
                        trial.metrics.decodedBodyBytes - replayedDiscoveryBytes,
                    replayedDiscoveryRequests,
                    budgetBefore,
                    budgetAfter,
                    observedBudgetDelta: Object.fromEntries(
                        (['core', 'search', 'graphql'] as const).map(
                            (resource) => [
                                resource,
                                budgetBefore[resource].reset ===
                                budgetAfter[resource].reset
                                    ? budgetAfter[resource].used -
                                      budgetBefore[resource].used
                                    : null,
                            ]
                        )
                    ),
                });
                if (trial.result.status !== 'success' || trial.result.rateLimit)
                    throw new Error(
                        'Live trial incomplete or throttled; discard performance claim'
                    );
            }
            const rest = outputs.rest!.result;
            const hybrid = outputs.hybrid!.result;
            if (rest.status !== 'success' || hybrid.status !== 'success')
                throw new Error('Unusable live pair');
            const avatarDiagnostics = (a: PullRequest[], b: PullRequest[]) => {
                let rawDifferences = 0;
                let sameHostAndPath = 0;
                for (const pr of a) {
                    const other = b.find((item) => item.id === pr.id);
                    if (
                        pr.author &&
                        other?.author &&
                        pr.author.avatar_url !== other.author.avatar_url
                    ) {
                        rawDifferences++;
                        const u = new URL(pr.author.avatar_url);
                        const v = new URL(other.author.avatar_url);
                        if (u.origin === v.origin && u.pathname === v.pathname)
                            sameHostAndPath++;
                    }
                }
                return { rawDifferences, sameHostAndPath };
            };
            trials.push({
                size,
                repeat,
                measurements: measured,
                differences: fieldDifferences(
                    rest.pullRequests,
                    hybrid.pullRequests
                ),
                avatarDiagnostics: avatarDiagnostics(
                    rest.pullRequests,
                    hybrid.pullRequests
                ),
            });
        }
    return {
        kind: 'live-public-fixed-membership-metadata-and-REST-supporting-requests',
        measuredAt: new Date().toISOString(),
        repository: 'cli/cli (public)',
        sizes,
        scope: 'Identity, canonical metadata and unchanged REST reviews/CI are live. REST discovery bodies are fixed-membership replay, counted separately. No browser storage/UI/notifications. Query histories are not default open-dashboard populations.',
        overheadHttpRequests,
        trials,
    };
}
import { fetchMetadata, type CanonicalDetail } from './client';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';

// A small, opt-in diagnostic, separate from timed trials. Only aggregate mismatch
// categories leave memory; the public PR payloads and identities are not saved.
export async function diagnoseLiveMetadata(token: string) {
    const network: typeof fetch = (input, init) => {
        const url = new URL(String(input));
        if (url.origin !== 'https://api.github.com')
            throw new Error('Unexpected diagnostic host');
        return fetch(input, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                ...init?.headers,
            },
        });
    };
    const budget = await network('https://api.github.com/rate_limit');
    const resources = (await budget.json()).resources;
    if (
        resources.core.remaining < 150 ||
        resources.graphql.remaining < 50 ||
        resources.search.remaining < 1
    )
        throw new Error('Insufficient diagnostic budget');
    const search = await network(
        `https://api.github.com/search/issues?q=${encodeURIComponent('repo:cli/cli is:pr sort:created-asc')}&per_page=100&page=1`
    );
    const body = await search.json();
    if (
        !search.ok ||
        body.incomplete_results ||
        !Array.isArray(body.items) ||
        body.items.length < 40
    )
        throw new Error('Incomplete diagnostic membership');
    const urls: string[] = body.items
        .slice(0, 40)
        .map(
            (item: { pull_request: { url: string } }) => item.pull_request.url
        );
    const graph = await fetchMetadata(urls, { token, transport: network });
    const raw = await mapWithConcurrency(urls, 4, async (url) => {
        const result = await network(url);
        if (!result.ok) throw new Error('Diagnostic detail inaccessible');
        return (await result.json()) as CanonicalDetail;
    });
    const fields: Record<string, number> = {};
    const avatarParameterKeys = new Set<string>();
    const unconsumedReviewerFields = new Set<string>();
    let reviewerArraysWithExtraFields = 0;
    const reviewer = {
        changedArrays: 0,
        sameLoginsSameOrder: 0,
        sameLoginSetDifferentOrder: 0,
        differentMembership: 0,
        avatarOnly: 0,
    };
    const repo = (r: CanonicalDetail['base']['repo'] | null) =>
        r
            ? {
                  name: r.name,
                  full_name: r.full_name,
                  url: r.url,
                  html_url: r.html_url,
              }
            : null;
    for (let index = 0; index < urls.length; index++) {
        const rest = raw[index]!;
        const node = graph.details.get(urls[index]!);
        if (!node) {
            fields.fallbackRequired = (fields.fallbackRequired ?? 0) + 1;
            continue;
        }
        const projected = {
            id: rest.id,
            number: rest.number,
            title: rest.title,
            html_url: rest.html_url,
            created_at: rest.created_at,
            updated_at: rest.updated_at,
            state: rest.state,
            merged: rest.merged,
            draft: rest.draft,
            user: rest.user
                ? { login: rest.user.login, avatar_url: rest.user.avatar_url }
                : null,
            requested_reviewers: rest.requested_reviewers.map((r) => ({
                login: r.login,
                avatar_url: r.avatar_url,
            })),
            requested_teams: rest.requested_teams.map((team) => ({
                slug: team.slug,
            })),
            base: { repo: repo(rest.base.repo) },
            head: { sha: rest.head.sha, repo: repo(rest.head.repo) },
        };
        for (const key of Object.keys(node) as (keyof CanonicalDetail)[])
            if (JSON.stringify(node[key]) !== JSON.stringify(projected[key]))
                fields[key] = (fields[key] ?? 0) + 1;
        if (
            projected.user &&
            node.user &&
            projected.user.avatar_url !== node.user.avatar_url
        ) {
            for (const value of [
                projected.user.avatar_url,
                node.user.avatar_url,
            ])
                for (const key of new URL(value).searchParams.keys())
                    avatarParameterKeys.add(key);
        }
        const extras = rest.requested_reviewers.flatMap((r) =>
            Object.keys(r).filter(
                (key) => !['login', 'avatar_url'].includes(key)
            )
        );
        if (extras.length) {
            reviewerArraysWithExtraFields++;
            for (const key of extras) unconsumedReviewerFields.add(key);
        }
        const a = projected.requested_reviewers;
        const b = node.requested_reviewers;
        if (JSON.stringify(a) !== JSON.stringify(b)) {
            reviewer.changedArrays++;
            if (
                JSON.stringify(a.map((r) => r.login)) ===
                JSON.stringify(b.map((r) => r.login))
            ) {
                reviewer.sameLoginsSameOrder++;
                reviewer.avatarOnly++;
            } else if (
                JSON.stringify(a.map((r) => r.login).sort()) ===
                JSON.stringify(b.map((r) => r.login).sort())
            )
                reviewer.sameLoginSetDifferentOrder++;
            else reviewer.differentMembership++;
        }
    }
    return {
        kind: 'live-public-canonical-field-diagnostic',
        measuredAt: new Date().toISOString(),
        repository: 'cli/cli (public)',
        count: 40,
        fields,
        reviewer,
        avatarParameterKeys: [...avatarParameterKeys].sort(),
        reviewerArraysWithExtraFields,
        unconsumedReviewerFields: [...unconsumedReviewerFields].sort(),
        httpRequests: 2 + urls.length + graph.rateUsage.length,
        overheadBudgetProbes: 1,
        graphqlReportedPoints: graph.rateUsage.reduce(
            (sum, rate) => sum + rate.cost,
            0
        ),
    };
}
