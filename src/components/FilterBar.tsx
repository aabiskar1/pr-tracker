import { useState } from 'react';
import { FaCheck, FaSort, FaFilter } from 'react-icons/fa';

interface FilterBarProps {
  onFilterChange: (filters: FilterState) => void;
  onSortChange: (sort: SortOption) => void;
}

export interface FilterState {
  showDrafts: boolean;
  showReady: boolean;
}

export type SortOption = 'newest' | 'oldest' | 'urgent';

export function FilterBar({ onFilterChange, onSortChange }: FilterBarProps) {
  const [filters, setFilters] = useState<FilterState>({
    showDrafts: true,
    showReady: true,
  });

  const handleFilterChange = (key: keyof FilterState) => {
    const newFilters = {
      ...filters,
      [key]: !filters[key],
    };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  return (
    <div className="flex flex-wrap justify-between items-center gap-3 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
          <FaFilter size={14} />
          <span className="font-medium text-sm">Filters:</span>
        </div>
        
        <div className="flex gap-3">
          <label className="flex items-center gap-2 cursor-pointer" title="Show or hide draft pull requests">
            <div className={`w-4 h-4 flex items-center justify-center rounded border ${filters.showDrafts ? 'bg-primary border-primary' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'}`}>
              {filters.showDrafts && <FaCheck size={10} className="text-white" />}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={filters.showDrafts}
              onChange={() => handleFilterChange('showDrafts')}
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
              onChange={() => handleFilterChange('showReady')}
              aria-label="Show Ready"
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">Ready</span>
          </label>
        </div>
      </div>
      
      <div className="flex items-center">
        <div className="relative">
          <select
            className="appearance-none pl-3 pr-8 py-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            defaultValue="newest"
            title="Sort pull requests"
            aria-label="Sort pull requests"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="urgent">Most Urgent</option>
          </select>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
            <FaSort size={12} className="text-gray-400" />
          </div>
        </div>
      </div>
    </div>
  );
}