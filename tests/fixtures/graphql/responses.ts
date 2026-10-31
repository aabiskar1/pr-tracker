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

// Distinct default-discovery results plus one PR shared by all three sources.
// Reviewed-only PRs have no outstanding reviewers and must still be retained.
export const defaultDiscoveryFixture = (login: string) => {
    const authored = {
        ...graphqlNode(1),
        author: { login, avatarUrl: `https://avatars.example/${login}.png` },
        isDraft: true,
    };
    const requested = {
        ...graphqlNode(2),
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequests: {
            pageInfo: { hasNextPage: false },
            nodes: [
                {
                    requestedReviewer: {
                        __typename: 'User',
                        login,
                        avatarUrl: `https://avatars.example/${login}.png`,
                    },
                },
            ],
        },
    };
    const reviewed = {
        ...graphqlNode(3),
        reviewDecision: 'CHANGES_REQUESTED',
        reviewRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
    };
    const shared = { ...graphqlNode(4), author: authored.author };
    return [
        {
            query: `is:open is:pr author:${login} archived:false`,
            pages: [graphqlPage([authored, shared])],
        },
        {
            query: `is:open is:pr review-requested:${login} archived:false`,
            pages: [graphqlPage([requested, shared])],
        },
        {
            query: `is:open is:pr reviewed-by:${login} archived:false`,
            pages: [
                graphqlPage(
                    [
                        reviewed,
                        shared,
                        ...Array.from({ length: 48 }, (_, i) =>
                            graphqlNode(i + 5)
                        ),
                    ],
                    51,
                    'reviewed-next',
                    true
                ),
                graphqlPage([graphqlNode(53)], 51),
            ],
        },
    ];
};
