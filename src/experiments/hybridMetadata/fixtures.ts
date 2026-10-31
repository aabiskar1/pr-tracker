import { targetFromUrl } from './client';

export function pairedFixture(index: number) {
    const repo = `service-${index % 4}`;
    const owner = 'fixture-org';
    const number = 500 + index;
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const web = `https://github.com/${owner}/${repo}`;
    const url = `${api}/pulls/${number}`;
    const count =
        index % 37 === 0 ? 101 : index % 9 === 0 ? 0 : index % 4 === 0 ? 3 : 1;
    const users = Array.from({ length: count }, (_, i) => ({
        login: i === 0 && index % 3 === 1 ? 'fixture-user' : `reviewer-${i}`,
        avatar_url: `https://avatars.example/${i}.png`,
    }));
    const author = {
        login: index % 3 === 0 ? 'other-author' : 'fixture-user',
        avatar_url: 'https://avatars.example/author.png',
    };
    const repository = {
        name: repo,
        nameWithOwner: `${owner}/${repo}`,
        url: web,
    };
    const sha = index.toString(16).padStart(40, '0');
    const created = '2026-01-15T10:00:00Z';
    const updated = '2026-02-15T11:00:00Z';
    const node = {
        __typename: 'PullRequest',
        fullDatabaseId: String(100000 + index),
        number,
        title: `Synthetic pull request ${index}`,
        url: `${web}/pull/${number}`,
        state: 'OPEN',
        isDraft: index % 5 === 0,
        createdAt: created,
        updatedAt: updated,
        repository,
        baseRepository: repository,
        headRepository:
            index % 11 === 0
                ? null
                : {
                      ...repository,
                      nameWithOwner: `fixture-fork/${repo}`,
                      url: `https://github.com/fixture-fork/${repo}`,
                  },
        headRefOid: sha,
        author:
            index % 13 === 0
                ? null
                : { login: author.login, avatarUrl: author.avatar_url },
        reviewRequests: {
            totalCount: users.length + (users.length ? 1 : 0),
            pageInfo: { hasNextPage: users.length > 99 },
            nodes: [
                ...users.map((user) => ({
                    requestedReviewer: {
                        __typename: 'User',
                        login: user.login,
                        avatarUrl: user.avatar_url,
                    },
                })),
                ...(users.length
                    ? [
                          {
                              requestedReviewer: {
                                  __typename: 'Team',
                                  slug: 'maintainers',
                              },
                          },
                      ]
                    : []),
            ].slice(0, 100),
        },
    };
    const toRepo = (r: typeof repository) => ({
        name: r.name,
        full_name: r.nameWithOwner,
        html_url: r.url,
        url: `https://api.github.com/repos/${r.nameWithOwner}`,
    });
    const detail = {
        id: 100000 + index,
        node_id: `opaque-node-${index}`,
        number,
        title: node.title,
        html_url: node.url,
        created_at: created,
        updated_at: updated,
        state: 'open',
        merged: false,
        draft: node.isDraft,
        user: node.author ? author : null,
        requested_reviewers: users,
        requested_teams: users.length ? [{ slug: 'maintainers' }] : [],
        base: { repo: toRepo(repository) },
        head: {
            sha,
            repo: node.headRepository ? toRepo(node.headRepository) : null,
        },
        // Real REST canonical responses include unused body, repository and link fields.
        // This is synthetic content, not a captured private response or a wire-size claim.
        body: 'A synthetic change description with implementation and test notes. '.repeat(
            60
        ),
        diff_url: `${node.url}.diff`,
        patch_url: `${node.url}.patch`,
        comments: 3,
        commits: 2,
        additions: 20,
        deletions: 10,
    };
    return { index, url, node, detail, target: targetFromUrl(url) };
}
export type Fixture = ReturnType<typeof pairedFixture>;
export type Fault =
    | 'none'
    | 'partial'
    | 'network'
    | 'timeout'
    | 'rate-limit'
    | 'missing-detail'
    | 'incomplete-search';
export function fixtureTransport(
    count: number,
    options: {
        restDelayMs?: number;
        graphqlDelayMs?: number;
        fault?: Fault;
    } = {}
) {
    const fixtures = Array.from({ length: count }, (_, i) =>
        pairedFixture(i + 1)
    );
    const usage = { core: 0, search: 0, graphql: 0 };
    const transport: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const graph = url.pathname === '/graphql';
        const delay = graph
            ? (options.graphqlDelayMs ?? 0)
            : (options.restDelayMs ?? 0);
        if (delay)
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
        init?.signal?.throwIfAborted();
        const resource = graph
            ? 'graphql'
            : url.pathname === '/search/issues'
              ? 'search'
              : 'core';
        usage[resource]++;
        const headers = {
            'x-ratelimit-resource': resource,
            'x-ratelimit-used': String(usage[resource]),
            'Content-Type': 'application/json',
        };
        const response = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), { status, headers });
        if (url.pathname === '/user')
            return response({
                login: 'fixture-user',
                avatar_url: 'https://avatars.example/self.png',
            });
        if (url.pathname === '/search/issues') {
            const q = url.searchParams.get('q') ?? '';
            const source = q.includes('reviewed-by:')
                ? 'reviewed'
                : q.includes('review-requested:')
                  ? 'review-requested'
                  : q.includes('author:')
                    ? 'authored'
                    : 'custom';
            const selected = fixtures.filter(
                (f) =>
                    source === 'custom' ||
                    (source === 'authored'
                        ? f.node.author?.login === 'fixture-user'
                        : source === 'reviewed'
                          ? f.index % 3 === 0 ||
                            f.index % 7 === 0 ||
                            f.node.author === null
                          : f.detail.requested_reviewers.some(
                                (reviewer) => reviewer.login === 'fixture-user'
                            ))
            );
            const page = Number(url.searchParams.get('page') ?? 1);
            return response({
                total_count: selected.length,
                incomplete_results: options.fault === 'incomplete-search',
                items: selected
                    .slice((page - 1) * 100, page * 100)
                    .map((f) => ({
                        id: f.detail.id,
                        node_id: f.detail.node_id,
                        pull_request: { url: f.url },
                    })),
            });
        }
        if (graph) {
            if (options.fault === 'network')
                throw new TypeError('Synthetic network failure');
            if (options.fault === 'timeout')
                return response(
                    { errors: [{ type: 'RESOURCE_LIMITS_EXCEEDED' }] },
                    502
                );
            if (options.fault === 'rate-limit')
                return new Response(
                    JSON.stringify({
                        errors: [
                            {
                                type: 'RATE_LIMITED',
                                message: 'API rate limit exceeded',
                            },
                        ],
                    }),
                    {
                        headers: {
                            ...headers,
                            'x-ratelimit-remaining': '0',
                            'x-ratelimit-reset': String(Date.now() / 1000 + 60),
                        },
                    }
                );
            const variables = JSON.parse(String(init?.body)).variables;
            const data: Record<string, unknown> = {
                rateLimit: {
                    cost: 1,
                    remaining: 4999,
                    resetAt: '2030-01-01T00:00:00Z',
                },
            };
            for (let i = 0; `n${i}` in variables; i++) {
                const fixture = fixtures.find(
                    (f) =>
                        f.target.owner === variables[`o${i}`] &&
                        f.target.repo === variables[`r${i}`] &&
                        f.target.number === variables[`n${i}`]
                );
                data[`p${i}`] = {
                    pullRequest:
                        options.fault === 'partial' && i === 0
                            ? null
                            : fixture?.node,
                };
            }
            return response({
                data,
                ...(options.fault === 'partial'
                    ? {
                          errors: [
                              {
                                  type: 'NOT_FOUND',
                                  path: ['p0', 'pullRequest'],
                              },
                          ],
                      }
                    : {}),
            });
        }
        const fixture = fixtures.find(
            (f) =>
                url.href === f.url ||
                url.href.startsWith(`${f.url}/`) ||
                url.pathname.includes(`/commits/${f.detail.head.sha}/`)
        );
        if (!fixture) throw new Error('Unexpected synthetic request');
        if (url.href === fixture.url)
            return options.fault === 'missing-detail'
                ? response({}, 404)
                : response(fixture.detail);
        if (url.pathname.endsWith('/reviews')) {
            if (fixture.index % 10 === 6)
                return response({ message: 'Forbidden' }, 403);
            const user = { id: 7 };
            if (fixture.index % 30 === 0)
                return response(
                    Array.from({ length: 30 }, () => ({
                        user,
                        state: 'APPROVED',
                    }))
                );
            return response([
                { user, state: 'APPROVED' },
                {
                    user,
                    state:
                        fixture.index % 10 === 9
                            ? 'COMMENTED'
                            : 'CHANGES_REQUESTED',
                },
            ]);
        }
        if (url.pathname.endsWith('/check-runs')) {
            if (fixture.index % 10 === 7)
                return response({ message: 'Forbidden' }, 403);
            const total =
                fixture.index % 10 === 1
                    ? 0
                    : fixture.index % 10 === 4
                      ? 145
                      : 1;
            const page = Number(url.searchParams.get('page') ?? 1);
            const check_runs = Array.from({ length: total }, (_, id) => ({
                id: id + 1,
                status: fixture.index % 10 === 2 ? 'in_progress' : 'completed',
                conclusion:
                    fixture.index % 10 === 2
                        ? null
                        : fixture.index % 10 === 3
                          ? 'failure'
                          : fixture.index % 10 === 5
                            ? 'timed_out'
                            : 'success',
            })).slice((page - 1) * 100, page * 100);
            return response({ total_count: total, check_runs });
        }
        if (url.pathname.endsWith('/status'))
            return response({ state: 'pending', total_count: 0, statuses: [] });
        throw new Error('Unexpected synthetic endpoint');
    };
    return { transport, fixtures };
}
