import { useState } from 'react';
import { FaCheck, FaTimes, FaSort } from 'react-icons/fa';

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
    <div className="filter-bar">
      <div className="filter-group">
        <label title="Show or hide draft pull requests">
          <input
            type="checkbox"
            checked={filters.showDrafts}
            onChange={() => handleFilterChange('showDrafts')}
            aria-label="Show Drafts"
          />
          <FaCheck /> Show Drafts
        </label>
        <label title="Show or hide ready pull requests">
          <input
            type="checkbox"
            checked={filters.showReady}
            onChange={() => handleFilterChange('showReady')}
            aria-label="Show Ready"
          />
          <FaTimes /> Show Ready
        </label>
      </div>
      <select
        className="sort-select"
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        defaultValue="newest"
        title="Sort pull requests"
        aria-label="Sort pull requests"
      >
        <option value="newest">Newest First</option>
        <option value="oldest">Oldest First</option>
        <option value="urgent">Most Urgent</option>
      </select>
      <FaSort />
    </div>
  );
}