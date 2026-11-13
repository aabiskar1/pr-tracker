import { z } from 'zod';
import type { GroupingPreferences, GroupingMutation } from '../types';
import { validatedRepositoryName } from './prGrouping';

// Covers all three current discovery queries, each bounded to 1,000 results.
export const MAX_COLLAPSED_REPOSITORIES = 3000;
export const GroupingModeSchema = z.enum(['none', 'repository']);
export const RepositoryKeySchema = z
    .string()
    .refine((value) => validatedRepositoryName(value) !== undefined)
    .transform((value) => value.toLowerCase());
export const GroupingMutationSchemas = [
    z
        .object({
            kind: z.literal('set-grouping-mode'),
            mode: GroupingModeSchema,
        })
        .strict(),
    z
        .object({
            kind: z.literal('set-repositories-collapsed'),
            repositories: z
                .array(RepositoryKeySchema)
                .max(MAX_COLLAPSED_REPOSITORIES),
            collapsed: z.boolean(),
        })
        .strict(),
] as const;

export function normalizeGroupingPreferences(
    value: unknown
): GroupingPreferences {
    const record =
        value && typeof value === 'object'
            ? (value as Record<string, unknown>)
            : {};
    const mode = GroupingModeSchema.safeParse(record.mode);
    const repositories = Array.isArray(record.collapsedRepositories)
        ? record.collapsedRepositories
        : [];
    const keys = new Set<string>();
    for (const repository of repositories) {
        const name = validatedRepositoryName(repository);
        if (name) keys.add(name.toLowerCase());
    }
    return {
        mode: mode.success ? mode.data : 'none',
        collapsedRepositories: [...keys].slice(-MAX_COLLAPSED_REPOSITORIES),
    };
}

export function applyGroupingMutation(
    preferences: GroupingPreferences,
    mutation: GroupingMutation
): GroupingPreferences {
    if (mutation.kind === 'set-grouping-mode')
        return { ...preferences, mode: mutation.mode };
    const keys = new Set(preferences.collapsedRepositories);
    for (const repository of mutation.repositories) {
        const key = repository.toLowerCase();
        if (mutation.collapsed) keys.add(key);
        else keys.delete(key);
    }
    if (keys.size > MAX_COLLAPSED_REPOSITORIES) {
        // Prefer every explicitly targeted repository over stale, absent names.
        // Ordinary no-op collapses leave ordering (and storage) unchanged.
        const requested = new Set(
            mutation.repositories.map((key) => key.toLowerCase())
        );
        const retained = [...keys].filter((key) => !requested.has(key));
        return {
            ...preferences,
            collapsedRepositories: [...retained, ...requested].slice(
                -MAX_COLLAPSED_REPOSITORIES
            ),
        };
    }
    return {
        ...preferences,
        collapsedRepositories: [...keys].slice(-MAX_COLLAPSED_REPOSITORIES),
    };
}

export function sameGroupingPreferences(
    a: GroupingPreferences,
    b: GroupingPreferences
): boolean {
    return (
        a.mode === b.mode &&
        a.collapsedRepositories.length === b.collapsedRepositories.length &&
        a.collapsedRepositories.every(
            (key, index) => key === b.collapsedRepositories[index]
        )
    );
}
