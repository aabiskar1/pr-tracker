import {
    FaCheck,
    FaSort,
    FaFilter,
    FaClock,
    FaCodeBranch,
    FaUserCheck,
} from 'react-icons/fa';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

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
    showHidden: boolean;
    ageFilter: PRAgeFilter;
    reviewStatus: ReviewStatus[];
    ciStatus: CIStatus[];
};

export type SortOption = 'newest' | 'oldest' | 'urgent' | 'most-stale';

export type PRAgeFilter = 'all' | 'today' | 'week' | 'older';
export type ReviewStatus = 'approved' | 'changes-requested' | 'pending';
export type CIStatus = 'passing' | 'failing' | 'pending';

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
    const handleFilterChange = (
        key: keyof FilterState,
        value: boolean | string | ReviewStatus[] | CIStatus[]
    ) => {
        const newFilters = {
            ...filters,
            [key]: value,
        };
        onFilterChange(newFilters);
    };

    return (
        <div
            data-slot="filter-bar"
            className="filter-bar-container flex w-full flex-col flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted p-3 text-foreground sm:flex-row sm:items-center"
        >
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 min-w-0">
                <div className="flex items-center gap-1 text-foreground">
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
                            data-selected={filters.showDrafts}
                            className={`popup-filter-check flex h-4 w-4 items-center justify-center rounded border ${filters.showDrafts ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'}`}
                        >
                            {filters.showDrafts && <FaCheck size={10} />}
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
                        <span className="text-sm text-muted-foreground">
                            Drafts
                        </span>
                    </label>
                    <label
                        className="flex items-center gap-2 cursor-pointer"
                        title="Show or hide ready pull requests"
                    >
                        <div
                            data-selected={filters.showReady}
                            className={`popup-filter-check flex h-4 w-4 items-center justify-center rounded border ${filters.showReady ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'}`}
                        >
                            {filters.showReady && <FaCheck size={10} />}
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
                        <span className="text-sm text-muted-foreground">
                            Ready
                        </span>
                    </label>

                    <label
                        className="flex items-center gap-2 cursor-pointer"
                        title="Show or hide hidden pull requests"
                    >
                        <div
                            data-selected={filters.showHidden}
                            className={`popup-filter-check flex h-4 w-4 items-center justify-center rounded border ${filters.showHidden ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'}`}
                        >
                            {filters.showHidden && <FaCheck size={10} />}
                        </div>
                        <input
                            type="checkbox"
                            className="sr-only"
                            checked={filters.showHidden}
                            onChange={() =>
                                handleFilterChange(
                                    'showHidden',
                                    !filters.showHidden
                                )
                            }
                            aria-label="Show Hidden"
                        />
                        <span className="text-sm text-muted-foreground">
                            Hidden
                        </span>
                    </label>
                </div>
                {/* PR Age Filter */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <FaClock size={14} className="text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                            Age:
                        </span>
                    </div>
                    <select
                        className="select-left rounded border border-input bg-background py-1 pl-2 pr-6 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
                            <FaUserCheck
                                size={14}
                                className="text-muted-foreground"
                            />
                            <span className="text-sm text-muted-foreground">
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
                                    <Badge
                                        data-review-status={status}
                                        data-selected={filters.reviewStatus.includes(
                                            status
                                        )}
                                        variant={
                                            filters.reviewStatus.includes(
                                                status
                                            )
                                                ? status === 'approved'
                                                    ? 'reviewApproved'
                                                    : status ===
                                                        'changes-requested'
                                                      ? 'reviewChanges'
                                                      : 'reviewAwaiting'
                                                : 'outline'
                                        }
                                        className="rounded-md"
                                    >
                                        {status === 'approved'
                                            ? 'Approved'
                                            : status === 'changes-requested'
                                              ? 'Changes'
                                              : 'Pending'}
                                    </Badge>
                                </label>
                            ))}
                        </div>
                    </div>
                    {/* CI Status Filter */}
                    <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
                        <div className="flex items-center gap-1">
                            <FaCodeBranch
                                size={14}
                                className="text-muted-foreground"
                            />
                            <span className="text-sm text-muted-foreground">
                                CI:
                            </span>
                        </div>
                        <div className="inline-flex flex-nowrap items-center gap-2 shrink min-w-0">
                            {(
                                ['passing', 'failing', 'pending'] as CIStatus[]
                            ).map((status) => (
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
                                    <Badge
                                        data-ci-status={status}
                                        data-selected={filters.ciStatus.includes(
                                            status
                                        )}
                                        variant={
                                            filters.ciStatus.includes(status)
                                                ? status === 'passing'
                                                    ? 'ciPassing'
                                                    : status === 'failing'
                                                      ? 'ciFailing'
                                                      : 'ciPending'
                                                : 'outline'
                                        }
                                        className="rounded-md"
                                    >
                                        {status.charAt(0).toUpperCase() +
                                            status.slice(1)}
                                    </Badge>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
                {/* Reset Filters Button */}
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="ml-2"
                    onClick={onReset}
                >
                    Reset Filters
                </Button>
            </div>
            {/* Right side: Sort dropdown and custom query */}
            <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
                <div className="relative">
                    <select
                        className="appearance-none rounded border border-input bg-background py-1 pl-3 pr-8 text-left text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
                        <option value="urgent">Most Reviewers</option>
                        <option value="most-stale">Most Stale</option>
                    </select>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                        <FaSort size={12} className="text-muted-foreground" />
                    </div>
                </div>
                {/* Custom Query Input */}
                <div className="flex flex-row items-center gap-2 flex-1 min-w-[220px] min-w-0">
                    <Input
                        type="text"
                        className="custom-query-input min-w-[200px] text-xs"
                        placeholder="Custom GitHub PR search (e.g. is:open is:pr user:myorg)"
                        value={customQueryInput}
                        onChange={(e) => setCustomQueryInput(e.target.value)}
                        aria-label="Custom GitHub search query"
                        name="custom-github-search-query"
                        autoComplete="off"
                    />
                    <Button
                        size="sm"
                        className="min-w-[48px]"
                        onClick={handleSaveCustomQuery}
                        disabled={
                            !customQueryInput.trim() ||
                            customQueryInput === customQuery
                        }
                        aria-label="Save custom search query"
                    >
                        Save
                    </Button>
                    {isCustomQueryActive && (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="min-w-[48px]"
                            onClick={handleResetCustomQuery}
                            aria-label="Reset to default search"
                        >
                            Reset
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
