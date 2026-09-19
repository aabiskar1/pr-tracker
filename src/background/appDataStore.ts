import { z } from 'zod';
import {
    decryptAppData,
    decryptHiddenPrIds,
    encryptAppData,
    encryptHiddenPrIds,
} from '../services/secureStorage';
import type { AppData, AppDataMutation } from '../types';

type AppDataMutator = (data: AppData) => void | Promise<void>;
type AppDataUpdateOptions = {
    isValid?: () => boolean;
};

const FilterStateSchema = z
    .object({
        showDrafts: z.boolean(),
        showReady: z.boolean(),
        showHidden: z.boolean(),
        ageFilter: z.enum(['all', 'today', 'week', 'older']),
        reviewStatus: z.array(
            z.enum(['approved', 'changes-requested', 'pending'])
        ),
        ciStatus: z.array(z.enum(['passing', 'failing', 'pending'])),
    })
    .strict();

const AppDataMutationSchema = z.discriminatedUnion('kind', [
    z
        .object({ kind: z.literal('set-filters'), filters: FilterStateSchema })
        .strict(),
    z
        .object({
            kind: z.literal('set-sort'),
            sort: z.enum(['newest', 'oldest', 'urgent', 'most-stale']),
        })
        .strict(),
    z
        .object({
            kind: z.literal('set-notifications-enabled'),
            enabled: z.boolean(),
        })
        .strict(),
    z
        .object({
            kind: z.literal('set-custom-query'),
            customQuery: z.string().nullable(),
        })
        .strict(),
    z
        .object({
            kind: z.literal('set-hidden'),
            id: z.number().int().nonnegative(),
            hidden: z.boolean(),
        })
        .strict(),
]);

let mutationQueue: Promise<void> = Promise.resolve();

function normalizeAppData(data: AppData | null): AppData {
    return {
        ...data,
        pullRequests: data?.pullRequests ?? [],
        lastUpdated: data?.lastUpdated ?? new Date().toISOString(),
        preferences: data?.preferences ?? {},
        oldPullRequests: data?.oldPullRequests ?? [],
    };
}

export function parseAppDataMutation(value: unknown): AppDataMutation | null {
    const parsed = AppDataMutationSchema.safeParse(value);
    return parsed.success ? (parsed.data as AppDataMutation) : null;
}

export function updateEncryptedAppData(
    password: string,
    mutator: AppDataMutator,
    options: AppDataUpdateOptions = {}
): Promise<AppData> {
    const assertValid = () => {
        if (options.isValid && !options.isValid()) {
            throw new Error('App-data update belongs to an invalid session');
        }
    };
    const mutation = mutationQueue.then(async () => {
        assertValid();
        const currentData = await decryptAppData<AppData>(password);
        assertValid();
        if (currentData === null) {
            throw new Error('Failed to decrypt app data for update');
        }

        const latestData = normalizeAppData(currentData);
        await mutator(latestData);
        assertValid();
        await encryptAppData(latestData, password, assertValid);
        return latestData;
    });

    mutationQueue = mutation.then(
        () => undefined,
        () => undefined
    );
    return mutation;
}

export function waitForAppDataMutations(): Promise<void> {
    return mutationQueue;
}

export function applyAppDataMutation(
    password: string,
    mutation: AppDataMutation
): Promise<AppData> {
    return updateEncryptedAppData(password, async (data) => {
        data.preferences ??= {};

        switch (mutation.kind) {
            case 'set-filters':
                data.preferences.filters = mutation.filters;
                break;
            case 'set-sort':
                data.preferences.sort = mutation.sort;
                break;
            case 'set-notifications-enabled':
                data.preferences.notificationsEnabled = mutation.enabled;
                break;
            case 'set-custom-query':
                if (mutation.customQuery === null) {
                    delete data.preferences.customQuery;
                } else {
                    data.preferences.customQuery = mutation.customQuery;
                }
                break;
            case 'set-hidden': {
                const hiddenIds = new Set(await decryptHiddenPrIds(password));
                if (mutation.hidden) {
                    hiddenIds.add(mutation.id);
                } else {
                    hiddenIds.delete(mutation.id);
                }
                await encryptHiddenPrIds(Array.from(hiddenIds), password);

                const applyHiddenState = (
                    pr: AppData['pullRequests'][number]
                ) =>
                    pr.id === mutation.id
                        ? { ...pr, hidden: mutation.hidden }
                        : pr;
                data.pullRequests = data.pullRequests.map(applyHiddenState);
                data.oldPullRequests =
                    data.oldPullRequests?.map(applyHiddenState) ?? [];
                break;
            }
        }
    });
}
