import type { AppData, PullRequest } from '../types';
import { updateEncryptedAppData } from './appDataStore';
import { createNotification } from './notifications';
import {
    assertRefreshSessionValid,
    isRefreshSessionInvalidated,
    type RefreshSessionContext,
} from './refreshSession';
import { constants, state } from './state';
import { isReviewedOnly } from '../utils/discoverySources';

export type PendingNotificationReplayResult =
    | 'displayed'
    | 'disabled'
    | 'manager-throttled'
    | 'throttled'
    | 'failed'
    | 'invalidated'
    | 'no-pending';

let replayQueue: Promise<void> = Promise.resolve();

const uniqueIds = (ids: number[]): number[] => Array.from(new Set(ids));

export async function advancePullRequestNotificationState(
    password: string,
    currentPullRequests: PullRequest[],
    notifyOnFirstRun: boolean,
    refreshSession: RefreshSessionContext
): Promise<AppData> {
    const eligiblePRs = currentPullRequests.filter((pr) => !isReviewedOnly(pr));
    const currentIds = new Set(eligiblePRs.map((pr) => pr.id));

    return updateEncryptedAppData(
        password,
        (appData) => {
            const oldPullRequests = appData.oldPullRequests ?? [];
            const oldById = new Map(oldPullRequests.map((pr) => [pr.id, pr]));
            const newIds = eligiblePRs
                .filter(
                    (pr) =>
                        !oldById.has(pr.id) ||
                        isReviewedOnly(oldById.get(pr.id)!)
                )
                .map((pr) => pr.id);
            const isFirstRun =
                oldPullRequests.length === 0 &&
                newIds.length === eligiblePRs.length;
            const eligibleNewIds =
                !isFirstRun || notifyOnFirstRun ? newIds : [];
            const relevantPendingIds = (
                appData.pendingNotificationPullRequestIds ?? []
            ).filter((id) => currentIds.has(id));

            appData.oldPullRequests = currentPullRequests;
            appData.pendingNotificationPullRequestIds = uniqueIds([
                ...relevantPendingIds,
                ...eligibleNewIds,
            ]);
        },
        { isValid: refreshSession.isValid }
    );
}

async function runPendingNotificationReplay(
    password: string,
    refreshSession: RefreshSessionContext
): Promise<PendingNotificationReplayResult> {
    try {
        let result: PendingNotificationReplayResult = 'no-pending';
        let shouldWrite = false;
        await updateEncryptedAppData(
            password,
            async (appData) => {
                assertRefreshSessionValid(refreshSession);
                const currentIds = new Set(
                    appData.pullRequests
                        .filter((pr) => !isReviewedOnly(pr))
                        .map((pr) => pr.id)
                );
                const storedPendingIds = uniqueIds(
                    appData.pendingNotificationPullRequestIds ?? []
                );
                const pendingIds = storedPendingIds.filter((id) =>
                    currentIds.has(id)
                );

                if (pendingIds.length !== storedPendingIds.length) {
                    appData.pendingNotificationPullRequestIds = pendingIds;
                    shouldWrite = true;
                }
                if (pendingIds.length === 0) return;

                const now = Date.now();
                if (
                    now - state.lastNewPRNotificationTime <
                    constants.NOTIFICATION_THROTTLE_MS
                ) {
                    result = 'manager-throttled';
                    return;
                }

                result = await createNotification(
                    undefined,
                    {
                        type: 'basic',
                        iconUrl: constants.NOTIFICATION_ICON,
                        title: 'New Pull Requests',
                        message: `You have ${pendingIds.length} new pull request${pendingIds.length > 1 ? 's' : ''}!`,
                    },
                    false,
                    refreshSession
                );

                if (result !== 'displayed') return;

                assertRefreshSessionValid(refreshSession);
                state.lastNewPRNotificationTime = now;
                const deliveredIds = new Set(pendingIds);
                appData.pendingNotificationPullRequestIds =
                    storedPendingIds.filter((id) => !deliveredIds.has(id));
                shouldWrite = true;
            },
            {
                isValid: refreshSession.isValid,
                shouldWrite: () => shouldWrite,
            }
        );
        assertRefreshSessionValid(refreshSession);
        return result;
    } catch (error) {
        if (isRefreshSessionInvalidated(error, refreshSession)) {
            return 'invalidated';
        }
        console.error('Failed to replay pending PR notifications:', error);
        return 'failed';
    }
}

export function replayPendingPullRequestNotifications(
    password: string,
    refreshSession: RefreshSessionContext
): Promise<PendingNotificationReplayResult> {
    const replay = replayQueue.then(() =>
        runPendingNotificationReplay(password, refreshSession)
    );
    replayQueue = replay.then(
        () => undefined,
        () => undefined
    );
    return replay;
}

export function replayPendingPullRequestNotificationsForActiveSession(): Promise<PendingNotificationReplayResult> {
    const password = state.sessionPassword;
    if (!password || state.sessionLocked) {
        return Promise.resolve('invalidated');
    }

    const generation = state.sessionGeneration;
    const controller = new AbortController();
    return replayPendingPullRequestNotifications(password, {
        signal: controller.signal,
        isValid: () =>
            state.sessionGeneration === generation && !state.sessionLocked,
    });
}
