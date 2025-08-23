import {
    FaCheck,
    FaSort,
    FaFilter,
    FaClock,
    FaCodeBranch,
    FaUserCheck,
} from 'react-icons/fa';

type FilterBarProps = {
    filters: FilterState;
    onFilterChange: (filters: FilterState) => void;
    onSortChange: (sort: SortOption) => void;
    onReset: () => void;
    sortOption: SortOption;
    customQueryInput: string;
    setCustomQueryInput: (v: string) => void;
    handleSaveCustomQuery: () => void;
    handleResetCustomQuery: () => void;
    isCustomQueryActive: boolean;
    customQuery: string;
};

export type FilterState = {
    showDrafts: boolean;
    showReady: boolean;
    ageFilter: PRAgeFilter;
    reviewStatus: ReviewStatus[];
    ciStatus: CIStatus[];
};

export type SortOption = 'newest' | 'oldest' | 'urgent' | 'most-stale';

export type PRAgeFilter = 'all' | 'today' | 'week' | 'older';
export type ReviewStatus = 'approved' | 'changes-requested' | 'pending';
export type CIStatus = 'passing' | 'failing' | 'pending';

// Helper function to get age indicator color - exported so it can be used by PR list components
export const getAgeColor = (date: string) => {
    const days =
        (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 1) return 'text-green-500';
    if (days < 7) return 'text-yellow-500';
    return 'text-red-500';
};

export function FilterBar({
    filters,
    onFilterChange,
    onSortChange,
    onReset,
    sortOption,
    customQueryInput,
    setCustomQueryInput,
    handleSaveCustomQuery,
    handleResetCustomQuery,
    isCustomQueryActive,
    customQuery,
}: FilterBarProps) {
    const handleFilterChange = (key: keyof FilterState, value: any) => {
        const newFilters = {
            ...filters,
            [key]: value,
        };
        onFilterChange(newFilters);
    };

    return (
        <div className="flex flex-col sm:flex-row flex-wrap justify-between items-start sm:items-center gap-3 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg filter-bar-container w-full">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 min-w-0">
                <div className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
                    <FaFilter size={14} />
                    <span className="font-medium text-sm">Filters:</span>
                </div>
                {/* PR Status Filters */}
                <div className="flex gap-3">
                    <label
                        className="flex items-center gap-2 cursor-pointer"
                        title="Show or hide draft pull requests"
                    >
                        <div
                            className={`w-4 h-4 flex items-center justify-center rounded border ${filters.showDrafts ? 'bg-primary border-primary' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'}`}
                        >
                            {filters.showDrafts && (
                                <FaCheck size={10} className="text-white" />
                            )}
                        </div>
                        <input
                            type="checkbox"
                            className="sr-only"
                            checked={filters.showDrafts}
                            onChange={() =>
                                handleFilterChange(
                                    'showDrafts',
                                    !filters.showDrafts
                                )
                            }
                            aria-label="Show Drafts"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                            Drafts
                        </span>
                    </label>
                    <label
                        className="flex items-center gap-2 cursor-pointer"
                        title="Show or hide ready pull requests"
                    >
                        <div
                            className={`w-4 h-4 flex items-center justify-center rounded border ${filters.showReady ? 'bg-primary border-primary' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'}`}
                        >
                            {filters.showReady && (
                                <FaCheck size={10} className="text-white" />
                            )}
                        </div>
                        <input
                            type="checkbox"
                            className="sr-only"
                            checked={filters.showReady}
                            onChange={() =>
                                handleFilterChange(
                                    'showReady',
                                    !filters.showReady
                                )
                            }
                            aria-label="Show Ready"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                            Ready
                        </span>
                    </label>
                </div>
                {/* PR Age Filter */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <FaClock size={14} className="text-gray-500" />
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                            Age:
                        </span>
                    </div>
                    <select
                        className="pl-2 pr-6 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-200 select-left"
                        value={filters.ageFilter}
                        onChange={(e) =>
                            handleFilterChange('ageFilter', e.target.value)
                        }
                        title="Filter by PR age"
                        name="pr-age-filter"
                        autoComplete="off"
                    >
                        <option value="all">All Time</option>
                        <option value="today">Today</option>
                        <option value="week">This Week</option>
                        <option value="older">Older</option>
                    </select>
                </div>
                {/* Reviews + CI grouped on the same row */}
                <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap min-w-0">
                    {/* Review Status Filter */}
                    <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
                    <div className="flex items-center gap-1">
                        <FaUserCheck size={14} className="text-gray-500" />
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                            Reviews:
                        </span>
                    </div>
                        <div className="inline-flex flex-nowrap items-center gap-2 shrink min-w-0">
                        {(
                            [
                                'approved',
                                'changes-requested',
                                'pending',
                            ] as ReviewStatus[]
                        ).map((status) => (
                            <label
                                key={status}
                                className="flex items-center gap-1 cursor-pointer"
                                title={`Show ${status.replace('-', ' ')} PRs`}
                            >
                                <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={filters.reviewStatus.includes(
                                        status
                                    )}
                                    onChange={() => {
                                        const newStatus =
                                            filters.reviewStatus.includes(
                                                status
                                            )
                                                ? filters.reviewStatus.filter(
                                                      (s) => s !== status
                                                  )
                                                : [
                                                      ...filters.reviewStatus,
                                                      status,
                                                  ];
                                        handleFilterChange(
                                            'reviewStatus',
                                            newStatus
                                        );
                                    }}
                                />
                                <div
                                    className={`px-2 py-1 rounded text-xs ${
                                        filters.reviewStatus.includes(status)
                                            ? status === 'approved'
                                                ? 'badge-approved'
                                                : status === 'changes-requested'
                                                  ? 'badge-changes'
                                                  : 'badge-pending'
                                            : 'badge-unselected'
                                    }`}
                                >
                                    {status === 'approved'
                                        ? 'Approved'
                                        : status === 'changes-requested'
                                          ? 'Changes'
                                          : 'Pending'}
                                </div>
                            </label>
                        ))}
                        </div>
                    </div>
                    {/* CI Status Filter */}
                    <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
                        <div className="flex items-center gap-1">
                            <FaCodeBranch size={14} className="text-gray-500" />
                            <span className="text-sm text-gray-600 dark:text-gray-300">
                                CI:
                            </span>
                        </div>
                        <div className="inline-flex flex-nowrap items-center gap-2 shrink min-w-0">
                        {(['passing', 'failing', 'pending'] as CIStatus[]).map(
                            (status) => (
                                <label
                                    key={status}
                                    className="flex items-center gap-1 cursor-pointer"
                                    title={`Show ${status} checks`}
                                >
                                    <input
                                        type="checkbox"
                                        className="sr-only"
                                        checked={filters.ciStatus.includes(
                                            status
                                        )}
                                        onChange={() => {
                                            const newStatus =
                                                filters.ciStatus.includes(
                                                    status
                                                )
                                                    ? filters.ciStatus.filter(
                                                          (s) => s !== status
                                                      )
                                                    : [
                                                          ...filters.ciStatus,
                                                          status,
                                                      ];
                                            handleFilterChange(
                                                'ciStatus',
                                                newStatus
                                            );
                                        }}
                                    />
                                    <div
                                        className={`px-2 py-1 rounded text-xs ${
                                            filters.ciStatus.includes(status)
                                                ? status === 'passing'
                                                    ? 'badge-passing'
                                                    : status === 'failing'
                                                      ? 'badge-failing'
                                                      : 'badge-pending'
                                                : 'badge-unselected'
                                        }`}
                                    >
                                        {status.charAt(0).toUpperCase() +
                                            status.slice(1)}
                                    </div>
                                </label>
                            )
                        )}
                        </div>
                    </div>
                </div>
                {/* Reset Filters Button */}
                <button
                    type="button"
                    className="ml-2 px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm border border-gray-300 dark:border-gray-600 whitespace-nowrap"
                    onClick={onReset}
                >
                    Reset Filters
                </button>
            </div>
            {/* Right side: Sort dropdown and custom query */}
            <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
                <div className="relative">
                    <select
                        className="appearance-none pl-3 pr-8 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary text-left"
                        onChange={(e) =>
                            onSortChange(e.target.value as SortOption)
                        }
                        value={sortOption}
                        title="Sort pull requests"
                        aria-label="Sort pull requests"
                        name="sort-pull-requests"
                        autoComplete="off"
                    >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="urgent">Most Urgent</option>
                        <option value="most-stale">Most Stale</option>
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                        <FaSort size={12} className="text-gray-400" />
                    </div>
                </div>
                {/* Custom Query Input */}
                <div className="flex flex-row items-center gap-2 flex-1 min-w-[220px] min-w-0">
                    <input
                        type="text"
            className="w-full min-w-[200px] px-3 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white text-xs"
                        placeholder="Custom GitHub PR search (e.g. is:open is:pr user:myorg)"
                        value={customQueryInput}
                        onChange={(e) => setCustomQueryInput(e.target.value)}
                        aria-label="Custom GitHub search query"
                        name="custom-github-search-query"
                        autoComplete="off"
                    />
                    <button
                        className="bg-primary text-white px-2 py-1 rounded-md hover:bg-primary/90 transition-colors min-w-[48px] text-xs"
                        onClick={handleSaveCustomQuery}
                        disabled={
                            !customQueryInput.trim() ||
                            customQueryInput === customQuery
                        }
                        aria-label="Save custom search query"
                    >
                        Save
                    </button>
                    {isCustomQueryActive && (
                        <button
                            className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors min-w-[48px] text-xs"
                            onClick={handleResetCustomQuery}
                            aria-label="Reset to default search"
                        >
                            Reset
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
