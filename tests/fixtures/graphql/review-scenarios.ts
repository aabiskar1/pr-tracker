type ReviewState =
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'COMMENTED'
    | 'DISMISSED'
    | 'PENDING';
type Decision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
type Label = 'approved' | 'changes-requested' | 'pending';
const review = (id: number, state: ReviewState) => ({ user: { id }, state });

// Summary decisions are supplied synthetic inputs, not predictions about live
// branch protection. Expected differences are evidence against substitution.
export const reviewScenarios: {
    name: string;
    reviews: ReturnType<typeof review>[];
    decision: Decision;
    rest: Label;
    graphql: Label;
}[] = [
    {
        name: 'multiple outstanding reviewers, no submitted reviews',
        reviews: [],
        decision: 'REVIEW_REQUIRED',
        rest: 'pending',
        graphql: 'pending',
    },
    {
        name: 'two reviewers approve',
        reviews: [review(10, 'APPROVED'), review(11, 'APPROVED')],
        decision: 'APPROVED',
        rest: 'approved',
        graphql: 'approved',
    },
    {
        name: 'change request overrides a different reviewer approval',
        reviews: [review(10, 'APPROVED'), review(11, 'CHANGES_REQUESTED')],
        decision: 'CHANGES_REQUESTED',
        rest: 'changes-requested',
        graphql: 'changes-requested',
    },
    {
        name: 'comment-only reviews from multiple users',
        reviews: [review(10, 'COMMENTED'), review(11, 'COMMENTED')],
        decision: null,
        rest: 'pending',
        graphql: 'pending',
    },
    {
        name: 'same reviewer replaces changes requested with approval',
        reviews: [
            review(10, 'CHANGES_REQUESTED'),
            review(10, 'APPROVED'),
            review(11, 'COMMENTED'),
        ],
        decision: 'APPROVED',
        rest: 'approved',
        graphql: 'approved',
    },
    {
        name: 'same reviewer replaces approval with changes requested',
        reviews: [review(10, 'APPROVED'), review(10, 'CHANGES_REQUESTED')],
        decision: 'CHANGES_REQUESTED',
        rest: 'changes-requested',
        graphql: 'changes-requested',
    },
    {
        name: 'later comment supersedes approval in the REST reducer',
        reviews: [review(10, 'APPROVED'), review(10, 'COMMENTED')],
        decision: 'APPROVED',
        rest: 'pending',
        graphql: 'approved',
    },
    {
        name: 'dismissed approval returns to pending',
        reviews: [review(10, 'DISMISSED')],
        decision: 'REVIEW_REQUIRED',
        rest: 'pending',
        graphql: 'pending',
    },
    {
        name: 'pending review overwrites an earlier approval in REST',
        reviews: [review(10, 'APPROVED'), review(10, 'PENDING')],
        decision: 'APPROVED',
        rest: 'pending',
        graphql: 'approved',
    },
    {
        name: 'one approval while the aggregate still requires review',
        reviews: [review(10, 'APPROVED')],
        decision: 'REVIEW_REQUIRED',
        rest: 'approved',
        graphql: 'pending',
    },
];

export const requestedReviewers = [
    { login: 'alice', avatar_url: 'https://avatars.example/alice.png' },
    { login: 'bob', avatar_url: 'https://avatars.example/bob.png' },
];

export const graphqlReviewRequests = (reviewers = requestedReviewers) => ({
    pageInfo: { hasNextPage: false },
    nodes: reviewers.map(({ login, avatar_url }) => ({
        requestedReviewer: { __typename: 'User', login, avatarUrl: avatar_url },
    })),
});
