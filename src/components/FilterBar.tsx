import { useState } from 'react';

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
        <label>
          <input
            type="checkbox"
            checked={filters.showDrafts}
            onChange={() => handleFilterChange('showDrafts')}
          />
          Show Drafts
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.showReady}
            onChange={() => handleFilterChange('showReady')}
          />
          Show Ready
        </label>
      </div>
      <select
        className="sort-select"
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        defaultValue="newest"
      >
        <option value="newest">Newest First</option>
        <option value="oldest">Oldest First</option>
        <option value="urgent">Most Urgent</option>
      </select>
    </div>
  );
}