export type CIStatus = 'passing' | 'failing' | 'pending' | 'no-ci' | 'unknown';

export type GitHubIssueSearchItem = {
    pull_request?: {
        url: string;
    };
};

export type GitHubReview = {
    state: string;
    user: {
        id: number;
    };
};

export type GitHubCheckRun = {
    conclusion: string | null;
    status: string;
};

export type GitHubChecksResponse = {
    check_runs: GitHubCheckRun[];
};

export type PullRequest = {
    // Absent in legacy snapshots. Custom results deliberately have no sources.
    discoverySources?: ('authored' | 'review-requested' | 'reviewed')[];
    id: number;
    title: string;
    html_url: string;
    repository: {
        name: string;
    };
    state: string;
    draft: boolean;
    created_at: string;
    requested_reviewers: { login: string; avatar_url: string }[];
    review_status?: 'approved' | 'changes-requested' | 'pending';
    ci_status?: CIStatus;
    author?: { login: string; avatar_url: string };
    base?: {
        repo: {
            name: string;
            url: string;
        };
    };
    user?: {
        login: string;
        avatar_url: string;
    };
    hidden?: boolean;
};

export type AppPreferences = {
    notificationsEnabled?: boolean;
    customQuery?: string;
    filters?: FilterState;
    sort?: SortOption;
};

export type AppData = {
    pullRequests: PullRequest[];
    lastUpdated: string;
    lastSuccessfulRefreshAt?: string;
    preferences?: AppPreferences;
    oldPullRequests?: PullRequest[];
    pendingNotificationPullRequestIds?: number[];
};

export type FilterState = {
    showReviewed: boolean;
    showDrafts: boolean;
    showReady: boolean;
    showHidden: boolean;
    ageFilter: 'all' | 'today' | 'week' | 'older';
    reviewStatus: ('approved' | 'changes-requested' | 'pending')[];
    ciStatus: CIStatus[];
    ciStatusVersion?: 1;
};

export type SortOption = 'newest' | 'oldest' | 'urgent' | 'most-stale';

export type AppDataMutation =
    | { kind: 'set-filters'; filters: FilterState }
    | { kind: 'set-sort'; sort: SortOption }
    | { kind: 'set-notifications-enabled'; enabled: boolean }
    | { kind: 'set-custom-query'; customQuery: string | null }
    | { kind: 'set-hidden'; id: number; hidden: boolean };

export type ThemePreference = 'light' | 'dark' | 'auto';
