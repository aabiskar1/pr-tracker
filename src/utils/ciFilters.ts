import type { FilterState } from '../types';

export function migrateCIFilters(filters: FilterState): FilterState {
    if (filters.ciStatusVersion === 1) return filters;
    // Legacy empty selections also meant all statuses. Preserve restricted selections.
    const allSelected =
        filters.ciStatus.length === 0 ||
        ['passing', 'failing', 'pending'].every((status) =>
            filters.ciStatus.includes(status as FilterState['ciStatus'][number])
        );
    return {
        ...filters,
        ciStatus: allSelected
            ? [
                  ...new Set([
                      ...filters.ciStatus,
                      'passing',
                      'failing',
                      'pending',
                      'no-ci',
                      'unknown',
                  ] as FilterState['ciStatus']),
              ]
            : filters.ciStatus,
        ciStatusVersion: 1,
    };
}
