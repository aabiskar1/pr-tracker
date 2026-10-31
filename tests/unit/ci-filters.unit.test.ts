import { describe, expect, it } from 'vitest';
import { migrateCIFilters } from '../../src/utils/ciFilters';
import type { FilterState } from '../../src/types';

const filters: FilterState = {
    showDrafts: false,
    showReady: true,
    showHidden: true,
    showReviewed: false,
    ageFilter: 'week',
    reviewStatus: ['approved'],
    ciStatus: ['passing', 'failing', 'pending'],
};

describe('CI filter migration', () => {
    it.each([
        { ciStatus: ['passing', 'failing', 'pending'] },
        { ciStatus: [] },
    ] as { ciStatus: FilterState['ciStatus'] }[])(
        'expands legacy all selection %j exactly once',
        ({ ciStatus }) => {
            const migrated = migrateCIFilters({ ...filters, ciStatus });
            expect(migrated).toEqual({
                ...filters,
                ciStatus: ['passing', 'failing', 'pending', 'no-ci', 'unknown'],
                ciStatusVersion: 1,
            });
            expect(migrateCIFilters(migrated)).toBe(migrated);
        }
    );
    it('retains restricted old selections and every unrelated field', () => {
        expect(migrateCIFilters({ ...filters, ciStatus: ['passing'] })).toEqual(
            { ...filters, ciStatus: ['passing'], ciStatusVersion: 1 }
        );
    });
    it('retains intentional new selections excluding no-ci and unknown', () => {
        expect(migrateCIFilters({ ...filters, ciStatusVersion: 1 })).toEqual({
            ...filters,
            ciStatusVersion: 1,
        });
    });
});
