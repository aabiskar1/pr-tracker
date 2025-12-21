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
    ci_status?: 'passing' | 'failing' | 'pending';
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
    preferences?: AppPreferences;
    oldPullRequests?: PullRequest[];
};

export type FilterState = {
    showDrafts: boolean;
    showReady: boolean;
    ageFilter: 'all' | 'today' | 'week' | 'older';
    reviewStatus: ('approved' | 'changes-requested' | 'pending')[];
    ciStatus: ('passing' | 'failing' | 'pending')[];
};

export type SortOption = 'newest' | 'oldest' | 'urgent' | 'most-stale';

export type ThemePreference = 'light' | 'dark' | 'auto';
