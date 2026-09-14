import type { AppData, PullRequest } from '../../src/types';

export const TEST_PASSWORD = 'deterministic-password';
export const TEST_TOKEN = 'ghp_deterministic_fixture_token';
export const FIXED_UPDATED_AT = '2026-01-15T12:00:00.000Z';

const avatar = (name: string) =>
    `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#2563eb"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10">${name[0].toUpperCase()}</text></svg>`
    )}`;

const reviewers = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
        login: `reviewer-${index + 1}`,
        avatar_url: avatar(`r${index + 1}`),
    }));

export const POPULATED_PRS: PullRequest[] = [
    {
        id: 101,
        title: 'Add new authentication flow',
        html_url: 'https://github.com/acme/auth-service/pull/101',
        repository: { name: 'auth-service' },
        state: 'open',
        draft: false,
        created_at: '2026-01-14T12:00:00.000Z',
        author: { login: 'alice', avatar_url: avatar('alice') },
        requested_reviewers: reviewers(2),
        review_status: 'pending',
        ci_status: 'passing',
    },
    {
        id: 102,
        title: 'Fix bug in dashboard components',
        html_url: 'https://github.com/acme/web-dashboard/pull/102',
        repository: { name: 'web-dashboard' },
        state: 'open',
        draft: true,
        created_at: '2026-01-10T12:00:00.000Z',
        author: { login: 'bob', avatar_url: avatar('bob') },
        requested_reviewers: reviewers(12),
        review_status: 'approved',
        ci_status: 'failing',
    },
    {
        id: 103,
        title: 'Refactor API gateway',
        html_url: 'https://github.com/acme/api-gateway/pull/103',
        repository: { name: 'api-gateway' },
        state: 'open',
        draft: false,
        created_at: '2026-01-12T12:00:00.000Z',
        author: { login: 'carol', avatar_url: avatar('carol') },
        requested_reviewers: reviewers(1),
        review_status: 'changes-requested',
        ci_status: 'pending',
    },
    {
        id: 104,
        title: 'WIP: Add dark mode support',
        html_url: 'https://github.com/acme/ui-library/pull/104',
        repository: { name: 'ui-library' },
        state: 'open',
        draft: true,
        created_at: '2026-01-13T12:00:00.000Z',
        author: { login: 'dana', avatar_url: avatar('dana') },
        requested_reviewers: [],
        review_status: 'pending',
        ci_status: 'passing',
    },
];

export const REFRESHED_PRS: PullRequest[] = [
    {
        ...POPULATED_PRS[0],
        id: 201,
        title: 'Deterministic refresh result',
        html_url: 'https://github.com/acme/auth-service/pull/201',
        created_at: '2026-01-15T11:00:00.000Z',
    },
];

export const DEFAULT_FILTERS = {
    showDrafts: true,
    showReady: true,
    showHidden: false,
    ageFilter: 'all' as const,
    reviewStatus: ['approved', 'changes-requested', 'pending'] as const,
    ciStatus: ['passing', 'failing', 'pending'] as const,
};

export const appData = (
    pullRequests: PullRequest[] = POPULATED_PRS
): AppData => ({
    pullRequests,
    oldPullRequests: pullRequests,
    lastUpdated: FIXED_UPDATED_AT,
    preferences: {
        notificationsEnabled: true,
        filters: {
            ...DEFAULT_FILTERS,
            reviewStatus: [...DEFAULT_FILTERS.reviewStatus],
            ciStatus: [...DEFAULT_FILTERS.ciStatus],
        },
        sort: 'newest',
    },
});
