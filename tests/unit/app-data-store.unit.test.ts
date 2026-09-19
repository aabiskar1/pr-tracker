import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyAppDataMutation,
    parseAppDataMutation,
    updateEncryptedAppData,
    waitForAppDataMutations,
} from '../../src/background/appDataStore';
import {
    decryptAppData,
    decryptHiddenPrIds,
    encryptAppData,
    encryptHiddenPrIds,
} from '../../src/services/secureStorage';
import type { AppData, FilterState, PullRequest } from '../../src/types';

vi.mock('../../src/services/secureStorage', () => ({
    decryptAppData: vi.fn(),
    decryptHiddenPrIds: vi.fn(),
    encryptAppData: vi.fn(),
    encryptHiddenPrIds: vi.fn(),
}));

const PASSWORD = 'active-password';
const FILTERS: FilterState = {
    showDrafts: false,
    showReady: true,
    showHidden: false,
    ageFilter: 'week',
    reviewStatus: ['pending'],
    ciStatus: ['passing'],
};

const pullRequest = (id: number): PullRequest => ({
    id,
    title: `PR ${id}`,
    html_url: `https://github.com/acme/repo/pull/${id}`,
    repository: { name: 'repo' },
    state: 'open',
    draft: false,
    created_at: '2030-06-01T00:00:00.000Z',
    requested_reviewers: [],
});

const initialData = (): AppData => ({
    pullRequests: [pullRequest(1)],
    oldPullRequests: [pullRequest(1)],
    lastUpdated: '2030-06-01T00:00:00.000Z',
    preferences: { sort: 'newest' },
});

const clone = <T>(value: T): T => structuredClone(value);
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('background-owned encrypted app-data mutations', () => {
    let storedData: AppData;
    let hiddenIds: number[];

    beforeEach(() => {
        vi.clearAllMocks();
        storedData = initialData();
        hiddenIds = [2];
        vi.mocked(decryptAppData).mockImplementation(async () =>
            clone(storedData)
        );
        vi.mocked(encryptAppData).mockImplementation(
            async (data, _password, beforeStore) => {
                beforeStore?.();
                storedData = clone(data as AppData);
            }
        );
        vi.mocked(decryptHiddenPrIds).mockImplementation(async () => [
            ...hiddenIds,
        ]);
        vi.mocked(encryptHiddenPrIds).mockImplementation(async (ids) => {
            hiddenIds = [...ids];
        });
    });

    it('preserves a popup preference while an overlapping refresh updates PR data', async () => {
        const firstWriteStarted = deferred<void>();
        const allowFirstWrite = deferred<void>();
        let writeCount = 0;
        vi.mocked(encryptAppData).mockImplementation(async (data) => {
            writeCount += 1;
            if (writeCount === 1) {
                firstWriteStarted.resolve();
                await allowFirstWrite.promise;
            }
            storedData = clone(data as AppData);
        });

        const preferenceUpdate = applyAppDataMutation(PASSWORD, {
            kind: 'set-sort',
            sort: 'oldest',
        });
        await firstWriteStarted.promise;
        const refreshUpdate = updateEncryptedAppData(PASSWORD, (data) => {
            data.pullRequests = [pullRequest(2)];
            data.lastUpdated = '2030-06-07T08:09:10.000Z';
        });

        expect(decryptAppData).toHaveBeenCalledOnce();
        allowFirstWrite.resolve();
        await Promise.all([preferenceUpdate, refreshUpdate]);

        expect(decryptAppData).toHaveBeenCalledTimes(2);
        expect(storedData.pullRequests).toEqual([pullRequest(2)]);
        expect(storedData.preferences?.sort).toBe('oldest');
    });

    it('applies queued preference updates to the latest completed state', async () => {
        await Promise.all([
            applyAppDataMutation(PASSWORD, {
                kind: 'set-sort',
                sort: 'most-stale',
            }),
            applyAppDataMutation(PASSWORD, {
                kind: 'set-filters',
                filters: FILTERS,
            }),
        ]);

        expect(storedData.preferences).toMatchObject({
            sort: 'most-stale',
            filters: FILTERS,
        });
        expect(decryptAppData).toHaveBeenCalledTimes(2);
    });

    it('serializes refresh mutations while preserving unrelated fields', async () => {
        await Promise.all([
            updateEncryptedAppData(PASSWORD, (data) => {
                data.pullRequests = [pullRequest(2)];
            }),
            updateEncryptedAppData(PASSWORD, (data) => {
                data.oldPullRequests = [pullRequest(3)];
            }),
        ]);

        expect(storedData.pullRequests).toEqual([pullRequest(2)]);
        expect(storedData.oldPullRequests).toEqual([pullRequest(3)]);
        expect(storedData.preferences?.sort).toBe('newest');
    });

    it('rejects an invalidated refresh mutation before encryption and drains the queue', async () => {
        const mutationStarted = deferred<void>();
        const releaseMutation = deferred<void>();
        let valid = true;
        const update = updateEncryptedAppData(
            PASSWORD,
            async (data) => {
                data.pullRequests = [pullRequest(9)];
                mutationStarted.resolve();
                await releaseMutation.promise;
            },
            { isValid: () => valid }
        );
        await mutationStarted.promise;

        valid = false;
        releaseMutation.resolve();

        await expect(update).rejects.toThrow('invalid session');
        await expect(waitForAppDataMutations()).resolves.toBeUndefined();
        expect(encryptAppData).not.toHaveBeenCalled();
        expect(storedData.pullRequests).toEqual([pullRequest(1)]);
    });

    it('updates hidden IDs and both encrypted PR snapshots in one queued mutation', async () => {
        storedData.pullRequests.push(pullRequest(2));
        storedData.oldPullRequests?.push(pullRequest(2));

        await applyAppDataMutation(PASSWORD, {
            kind: 'set-hidden',
            id: 1,
            hidden: true,
        });

        expect(hiddenIds).toEqual([2, 1]);
        expect(storedData.pullRequests[0].hidden).toBe(true);
        expect(storedData.oldPullRequests?.[0].hidden).toBe(true);
    });

    it.each(['decrypt', 'write', 'mutator'] as const)(
        'releases the queue after a failed %s step',
        async (failure) => {
            if (failure === 'decrypt') {
                vi.mocked(decryptAppData).mockResolvedValueOnce(null);
            } else if (failure === 'write') {
                vi.mocked(encryptAppData).mockRejectedValueOnce(
                    new Error('write failed')
                );
            }

            const failedUpdate = updateEncryptedAppData(PASSWORD, () => {
                if (failure === 'mutator') {
                    throw new Error('mutation failed');
                }
            });
            await expect(failedUpdate).rejects.toThrow();

            await applyAppDataMutation(PASSWORD, {
                kind: 'set-notifications-enabled',
                enabled: false,
            });

            expect(storedData.preferences?.notificationsEnabled).toBe(false);
        }
    );

    it('creates the current encrypted envelope when app data is absent', async () => {
        vi.mocked(decryptAppData).mockResolvedValueOnce({} as AppData);

        await applyAppDataMutation(PASSWORD, {
            kind: 'set-notifications-enabled',
            enabled: false,
        });

        expect(storedData.pullRequests).toEqual([]);
        expect(storedData.oldPullRequests).toEqual([]);
        expect(storedData.lastUpdated).toEqual(expect.any(String));
        expect(storedData.preferences?.notificationsEnabled).toBe(false);
    });

    it('accepts only explicit validated mutation payloads', () => {
        expect(
            parseAppDataMutation({ kind: 'set-sort', sort: 'oldest' })
        ).toEqual({ kind: 'set-sort', sort: 'oldest' });
        expect(
            parseAppDataMutation({
                kind: 'set-sort',
                sort: 'oldest',
                arbitraryPath: 'pullRequests',
            })
        ).toBeNull();
        expect(
            parseAppDataMutation({ kind: 'set-hidden', id: '1', hidden: true })
        ).toBeNull();
    });
});
