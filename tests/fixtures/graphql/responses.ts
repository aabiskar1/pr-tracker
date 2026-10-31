// Synthetic, fixed GitHub-shaped responses. No credentials or live captures.
export const graphqlNode = (id = 1) => ({
    __typename: 'PullRequest',
    fullDatabaseId: String(id),
    title: `PR ${id}`,
    url: `https://github.com/acme/repo-${id}/pull/${id}`,
    state: 'OPEN',
    isDraft: false,
    createdAt: '2025-01-02T03:04:05.000Z',
    repository: { name: `repo-${id}` },
    author: {
        login: 'author',
        avatarUrl: 'https://avatars.example/author.png',
    },
    reviewDecision: 'APPROVED',
    statusCheckRollup: { state: 'SUCCESS' },
    reviewRequests: {
        pageInfo: { hasNextPage: false },
        nodes: [
            {
                requestedReviewer: {
                    __typename: 'User',
                    login: 'reviewer',
                    avatarUrl: 'https://avatars.example/reviewer.png',
                },
            },
        ],
    },
});

export const graphqlPage = (
    nodes: unknown[] = [graphqlNode()],
    count = nodes.length,
    cursor: string | null = null,
    hasNextPage = false
) => ({
    data: {
        search: {
            issueCount: count,
            nodes,
            pageInfo: { endCursor: cursor, hasNextPage },
        },
        // Synthetic telemetry tests plumbing only; never a measured GitHub cost.
        rateLimit: {
            cost: 1,
            remaining: 4999,
            resetAt: '2030-01-01T01:00:00Z',
        },
    },
});
