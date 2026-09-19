import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    advancePullRequestNotificationState,
    replayPendingPullRequestNotifications,
    replayPendingPullRequestNotificationsForActiveSession,
} from '../../src/background/notificationReplay';
import { createNotification } from '../../src/background/notifications';
import { updateEncryptedAppData } from '../../src/background/appDataStore';
import { constants, state } from '../../src/background/state';
import {
    decryptAppData,
    encryptAppData,
} from '../../src/services/secureStorage';
import type { AppData, PullRequest } from '../../src/types';

vi.mock('../../src/services/secureStorage', () => ({
    decryptAppData: vi.fn(),
    encryptAppData: vi.fn(),
    decryptHiddenPrIds: vi.fn(),
    encryptHiddenPrIds: vi.fn(),
}));

vi.mock('../../src/background/notifications', () => ({
    createNotification: vi.fn(async () => 'displayed'),
}));

const PASSWORD = 'active-password';
const FIXED_TIME = new Date('2030-06-07T08:09:10.000Z');

const pullRequest = (id: number, hidden = false): PullRequest => ({
    id,
    title: `PR ${id}`,
    html_url: `https://github.com/acme/repo/pull/${id}`,
    repository: { name: 'repo' },
    state: 'open',
    draft: false,
    created_at: '2030-06-01T00:00:00.000Z',
    requested_reviewers: [],
    ...(hidden ? { hidden: true } : {}),
});

const appData = (overrides: Partial<AppData> = {}): AppData => ({
    pullRequests: [pullRequest(1)],
    oldPullRequests: [pullRequest(1)],
    lastUpdated: FIXED_TIME.toISOString(),
    preferences: { notificationsEnabled: true },
    pendingNotificationPullRequestIds: [],
    ...overrides,
});

const clone = <T>(value: T): T => structuredClone(value);
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const session = () => {
    const controller = new AbortController();
    let valid = true;
    return {
        context: {
            signal: controller.signal,
            isValid: () => valid,
        },
        invalidate: () => {
            valid = false;
            controller.abort();
        },
    };
};

describe('durable pending PR notification replay', () => {
    let storedData: AppData;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_TIME);
        state.lastNewPRNotificationTime = 0;
        state.sessionPassword = PASSWORD;
        state.sessionGeneration = 0;
        state.sessionLocked = false;
        storedData = appData();
        vi.mocked(decryptAppData).mockImplementation(async () =>
            clone(storedData)
        );
        vi.mocked(encryptAppData).mockImplementation(
            async (data, _password, beforeStore) => {
                beforeStore?.();
                storedData = clone(data as AppData);
            }
        );
        vi.mocked(createNotification).mockResolvedValue('displayed');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('migrates missing pending state without queuing an initial snapshot', async () => {
        storedData = appData({
            pullRequests: [],
            oldPullRequests: undefined,
            pendingNotificationPullRequestIds: undefined,
        });
        const operation = session();

        await advancePullRequestNotificationState(
            PASSWORD,
            [pullRequest(1), pullRequest(2)],
            false,
            operation.context
        );

        expect(storedData.oldPullRequests?.map((pr) => pr.id)).toEqual([1, 2]);
        expect(storedData.pendingNotificationPullRequestIds).toEqual([]);
    });

    it('queues one genuinely new PR while display is disabled and still advances the snapshot', async () => {
        const current = [pullRequest(1), pullRequest(2)];
        storedData.pullRequests = current;
        const operation = session();
        vi.mocked(createNotification).mockResolvedValueOnce('disabled');

        await advancePullRequestNotificationState(
            PASSWORD,
            current,
            false,
            operation.context
        );
        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('disabled');

        expect(storedData.oldPullRequests).toEqual(current);
        expect(storedData.pendingNotificationPullRequestIds).toEqual([2]);
    });

    it('does not attempt delivery before the comparison and pending state commit succeeds', async () => {
        const current = [pullRequest(1), pullRequest(2)];
        storedData.pullRequests = current;
        const original = clone(storedData);
        const operation = session();
        vi.mocked(encryptAppData).mockRejectedValueOnce(
            new Error('storage unavailable')
        );

        await expect(
            advancePullRequestNotificationState(
                PASSWORD,
                current,
                false,
                operation.context
            )
        ).rejects.toThrow('storage unavailable');

        expect(createNotification).not.toHaveBeenCalled();
        expect(storedData).toEqual(original);
    });

    it('groups discoveries from multiple disabled refreshes and clears them after one accepted delivery', async () => {
        const operation = session();
        vi.mocked(createNotification).mockResolvedValue('disabled');

        storedData.pullRequests = [pullRequest(1), pullRequest(2)];
        await advancePullRequestNotificationState(
            PASSWORD,
            [pullRequest(1), pullRequest(2)],
            false,
            operation.context
        );
        await replayPendingPullRequestNotifications(
            PASSWORD,
            operation.context
        );
        storedData.pullRequests = [
            pullRequest(1),
            pullRequest(2),
            pullRequest(3, true),
        ];
        await advancePullRequestNotificationState(
            PASSWORD,
            [pullRequest(1), pullRequest(2), pullRequest(3, true)],
            false,
            operation.context
        );
        await replayPendingPullRequestNotifications(
            PASSWORD,
            operation.context
        );

        expect(storedData.pendingNotificationPullRequestIds).toEqual([2, 3]);
        vi.mocked(createNotification).mockResolvedValueOnce('displayed');
        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('displayed');

        expect(createNotification).toHaveBeenLastCalledWith(
            undefined,
            expect.objectContaining({
                title: 'New Pull Requests',
                message: 'You have 2 new pull requests!',
            }),
            false,
            operation.context
        );
        expect(storedData.pendingNotificationPullRequestIds).toEqual([]);

        vi.advanceTimersByTime(constants.NOTIFICATION_THROTTLE_MS);
        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('no-pending');
    });

    it('removes a pending PR that disappears from a later complete snapshot', async () => {
        storedData = appData({
            pullRequests: [pullRequest(1), pullRequest(2)],
            oldPullRequests: [pullRequest(1), pullRequest(2)],
            pendingNotificationPullRequestIds: [2],
        });
        const operation = session();

        await advancePullRequestNotificationState(
            PASSWORD,
            [pullRequest(1)],
            false,
            operation.context
        );

        expect(storedData.pendingNotificationPullRequestIds).toEqual([]);
        expect(storedData.oldPullRequests?.map((pr) => pr.id)).toEqual([1]);
    });

    it('observes a complete snapshot update queued before replay and excludes the disappeared PR', async () => {
        storedData = appData({
            pullRequests: [pullRequest(1), pullRequest(2)],
            oldPullRequests: [pullRequest(1), pullRequest(2)],
            pendingNotificationPullRequestIds: [2],
        });
        const operation = session();
        const snapshotUpdate = updateEncryptedAppData(PASSWORD, (data) => {
            data.pullRequests = [pullRequest(1)];
            data.oldPullRequests = [pullRequest(1)];
        });
        const replay = replayPendingPullRequestNotifications(
            PASSWORD,
            operation.context
        );

        await snapshotUpdate;
        await expect(replay).resolves.toBe('no-pending');
        expect(createNotification).not.toHaveBeenCalled();
        expect(storedData.pendingNotificationPullRequestIds).toEqual([]);
    });

    it('keeps hidden PRs eligible and deduplicates IDs already pending', async () => {
        storedData = appData({ pendingNotificationPullRequestIds: [2] });
        const operation = session();

        await advancePullRequestNotificationState(
            PASSWORD,
            [pullRequest(1), pullRequest(2, true)],
            false,
            operation.context
        );

        expect(storedData.pendingNotificationPullRequestIds).toEqual([2]);
    });

    it('retains candidates through manager and delivery throttles', async () => {
        storedData = appData({
            pullRequests: [pullRequest(1), pullRequest(2)],
            pendingNotificationPullRequestIds: [2],
        });
        const operation = session();
        state.lastNewPRNotificationTime = FIXED_TIME.getTime();

        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('manager-throttled');
        expect(storedData.pendingNotificationPullRequestIds).toEqual([2]);

        vi.advanceTimersByTime(constants.NOTIFICATION_THROTTLE_MS);
        vi.mocked(createNotification).mockResolvedValueOnce('throttled');
        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('throttled');
        expect(storedData.pendingNotificationPullRequestIds).toEqual([2]);
    });

    it('keeps browser API failures retryable until a later accepted delivery', async () => {
        storedData = appData({
            pullRequests: [pullRequest(1), pullRequest(2)],
            pendingNotificationPullRequestIds: [2],
        });
        const operation = session();
        vi.mocked(createNotification)
            .mockResolvedValueOnce('failed')
            .mockResolvedValueOnce('displayed');

        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('failed');
        expect(storedData.pendingNotificationPullRequestIds).toEqual([2]);

        vi.advanceTimersByTime(constants.NOTIFICATION_THROTTLE_MS);
        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('displayed');
        expect(storedData.pendingNotificationPullRequestIds).toEqual([]);
    });

    it('does not display or mutate pending state when the session locks during replay', async () => {
        storedData = appData({
            pullRequests: [pullRequest(1), pullRequest(2)],
            pendingNotificationPullRequestIds: [2],
        });
        const original = clone(storedData);
        const read = deferred<AppData | null>();
        vi.mocked(decryptAppData).mockReturnValueOnce(read.promise);
        const operation = session();
        const replay = replayPendingPullRequestNotifications(
            PASSWORD,
            operation.context
        );
        await vi.waitFor(() => {
            expect(decryptAppData).toHaveBeenCalledOnce();
        });

        operation.invalidate();
        read.resolve(clone(storedData));

        await expect(replay).resolves.toBe('invalidated');
        expect(createNotification).not.toHaveBeenCalled();
        expect(storedData).toEqual(original);
    });

    it('keeps pending IDs across sign-out and replays them after password-only sign-in', async () => {
        storedData = appData({
            pullRequests: [pullRequest(1), pullRequest(2)],
            pendingNotificationPullRequestIds: [2],
        });
        const oldRead = deferred<AppData | null>();
        vi.mocked(decryptAppData).mockReturnValueOnce(oldRead.promise);

        const oldReplay =
            replayPendingPullRequestNotificationsForActiveSession();
        await vi.waitFor(() => {
            expect(decryptAppData).toHaveBeenCalledOnce();
        });

        state.sessionGeneration += 1;
        state.sessionLocked = true;
        state.sessionPassword = null;
        state.sessionGeneration += 1;
        state.sessionLocked = false;
        state.sessionPassword = PASSWORD;
        const newReplay =
            replayPendingPullRequestNotificationsForActiveSession();
        oldRead.resolve(clone(storedData));

        await expect(oldReplay).resolves.toBe('invalidated');
        await expect(newReplay).resolves.toBe('displayed');
        expect(createNotification).toHaveBeenCalledOnce();
        expect(storedData.pendingNotificationPullRequestIds).toEqual([]);
    });

    it('queues opted-in first-run PRs but not historical PRs by default', async () => {
        storedData = appData({
            pullRequests: [],
            oldPullRequests: [],
            pendingNotificationPullRequestIds: [],
        });
        const operation = session();

        await advancePullRequestNotificationState(
            PASSWORD,
            [pullRequest(1)],
            true,
            operation.context
        );

        expect(storedData.pendingNotificationPullRequestIds).toEqual([1]);
    });

    it('does not duplicate an accepted replay after background module recreation', async () => {
        storedData = appData({
            pullRequests: [pullRequest(1), pullRequest(2)],
            pendingNotificationPullRequestIds: [2],
        });
        const operation = session();

        await expect(
            replayPendingPullRequestNotifications(PASSWORD, operation.context)
        ).resolves.toBe('displayed');
        expect(storedData.pendingNotificationPullRequestIds).toEqual([]);

        vi.resetModules();
        const restartedReplay =
            await import('../../src/background/notificationReplay');
        const restartedNotifications =
            await import('../../src/background/notifications');
        const restartedStorage =
            await import('../../src/services/secureStorage');
        vi.mocked(restartedStorage.decryptAppData).mockResolvedValue(
            clone(storedData)
        );
        vi.mocked(restartedNotifications.createNotification).mockClear();

        await expect(
            restartedReplay.replayPendingPullRequestNotifications(
                PASSWORD,
                operation.context
            )
        ).resolves.toBe('no-pending');
        expect(
            restartedNotifications.createNotification
        ).not.toHaveBeenCalled();
    });
});
