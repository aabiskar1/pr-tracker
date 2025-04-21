import { useState } from 'react';
import { FaCheck, FaSort, FaFilter, FaClock, FaCodeBranch, FaUserCheck } from 'react-icons/fa';

type FilterBarProps = {
  onFilterChange: (filters: FilterState) => void;
  onSortChange: (sort: SortOption) => void;
}

export type FilterState = {
  showDrafts: boolean;
  showReady: boolean;
  ageFilter: PRAgeFilter;
  reviewStatus: ReviewStatus[];
  ciStatus: CIStatus[];
}

export type SortOption = 'newest' | 'oldest' | 'urgent' | 'most-stale';

export type PRAgeFilter = 'all' | 'today' | 'week' | 'older';
export type ReviewStatus = 'approved' | 'changes-requested' | 'pending';
export type CIStatus = 'passing' | 'failing' | 'pending';

// Helper function to get age indicator color - exported so it can be used by PR list components
export const getAgeColor = (date: string) => {
  const days = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 1) return 'text-green-500';
  if (days < 7) return 'text-yellow-500';
  return 'text-red-500';
};

export function FilterBar({ onFilterChange, onSortChange }: FilterBarProps) {
  const [filters, setFilters] = useState<FilterState>({
    showDrafts: true,
    showReady: true,
    ageFilter: 'all',
    reviewStatus: ['approved', 'changes-requested', 'pending'],
    ciStatus: ['passing', 'failing', 'pending']
  });

  const handleFilterChange = (key: keyof FilterState, value: any) => {
    const newFilters = {
      ...filters,
      [key]: value
    };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  return (
    <div className="flex flex-wrap justify-between items-center gap-3 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg filter-bar-container">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
          <FaFilter size={14} />
          <span className="font-medium text-sm">Filters:</span>
        </div>
        
        {/* PR Status Filters */}
        <div className="flex gap-3">
          <label className="flex items-center gap-2 cursor-pointer" title="Show or hide draft pull requests">
            <div className={`w-4 h-4 flex items-center justify-center rounded border ${filters.showDrafts ? 'bg-primary border-primary' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'}`}>
              {filters.showDrafts && <FaCheck size={10} className="text-white" />}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={filters.showDrafts}
              onChange={() => handleFilterChange('showDrafts', !filters.showDrafts)}
              aria-label="Show Drafts"
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">Drafts</span>
          </label>
          
          <label className="flex items-center gap-2 cursor-pointer" title="Show or hide ready pull requests">
            <div className={`w-4 h-4 flex items-center justify-center rounded border ${filters.showReady ? 'bg-primary border-primary' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'}`}>
              {filters.showReady && <FaCheck size={10} className="text-white" />}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={filters.showReady}
              onChange={() => handleFilterChange('showReady', !filters.showReady)}
              aria-label="Show Ready"
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">Ready</span>
          </label>
        </div>

        {/* PR Age Filter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <FaClock size={14} className="text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Age:</span>
          </div>
          <select
            className="pl-2 pr-6 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-200"
            value={filters.ageFilter}
            onChange={(e) => handleFilterChange('ageFilter', e.target.value)}
            title="Filter by PR age"
            style={{textAlignLast: 'left'}}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="older">Older</option>
          </select>
        </div>

        {/* Review Status Filter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <FaUserCheck size={14} className="text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Reviews:</span>
          </div>
          <div className="flex gap-2">
            {(['approved', 'changes-requested', 'pending'] as ReviewStatus[]).map(status => (
              <label 
                key={status}
                className="flex items-center gap-1 cursor-pointer"
                title={`Show ${status.replace('-', ' ')} PRs`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={filters.reviewStatus.includes(status)}
                  onChange={() => {
                    const newStatus = filters.reviewStatus.includes(status)
                      ? filters.reviewStatus.filter(s => s !== status)
                      : [...filters.reviewStatus, status];
                    handleFilterChange('reviewStatus', newStatus);
                  }}
                />
                <div className={`px-2 py-1 rounded text-xs ${
                  filters.reviewStatus.includes(status)
                    ? status === 'approved'
                      ? 'badge-approved'
                      : status === 'changes-requested'
                      ? 'badge-changes'
                      : 'badge-pending'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}>
                  {status === 'approved' ? 'Approved' : status === 'changes-requested' ? 'Changes' : 'Pending'}
                </div>
              </label>
            ))}

          </div>
        </div>

        {/* CI Status Filter */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <FaCodeBranch size={14} className="text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-300">CI:</span>
          </div>
          <div className="flex gap-2">
            {(['passing', 'failing', 'pending'] as CIStatus[]).map(status => (
              <label 
                key={status}
                className="flex items-center gap-1 cursor-pointer"
                title={`Show ${status} checks`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={filters.ciStatus.includes(status)}
                  onChange={() => {
                    const newStatus = filters.ciStatus.includes(status)
                      ? filters.ciStatus.filter(s => s !== status)
                      : [...filters.ciStatus, status];
                    handleFilterChange('ciStatus', newStatus);
                  }}
                />
                <div className={`px-2 py-1 rounded text-xs ${
                  filters.ciStatus.includes(status)
                    ? status === 'passing'
                      ? 'badge-passing'
                      : status === 'failing'
                      ? 'badge-failing'
                      : 'badge-pending'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }`}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
              </label>
            ))}

          </div>
        </div>
      </div>
      
      {/* Sort Dropdown */}
      <div className="flex items-center">
        <div className="relative">
          <select
            className="appearance-none pl-3 pr-8 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            defaultValue="newest"
            title="Sort pull requests"
            aria-label="Sort pull requests"
            style={{textAlignLast: 'left'}}
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
      </div>
    </div>
  );
}