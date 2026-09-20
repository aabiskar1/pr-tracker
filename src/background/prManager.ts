import browser from 'webextension-polyfill';
import {
    decryptToken,
    decryptAppData,
    decryptHiddenPrIds,
} from '../services/secureStorage';
import type { AppData } from '../types';
import { fetchPullRequests, handleApiError } from './api';
import { createNotification, setBadgeText } from './notifications';
import { state, constants } from './state';
import { updateEncryptedAppData } from './appDataStore';
import {
    clearGitHubRateLimitCooldown,
    formatGitHubCooldownTime,
    getActiveGitHubRateLimitCooldown,
    persistGitHubRateLimitCooldown,
} from './githubRateLimit';
import {
    assertRefreshSessionValid,
    isRefreshSessionInvalidated,
    type RefreshSessionContext,
} from './refreshSession';
import {
    advancePullRequestNotificationState,
    replayPendingPullRequestNotifications,
} from './notificationReplay';

type InFlightRefresh = {
    controller: AbortController;
    generation: number;
    promise: Promise<void>;
};

let inFlightRefresh: InFlightRefresh | null = null;

function retireInFlightRefresh(): void {
    const retiredRefresh = inFlightRefresh;
    if (!retiredRefresh) return;

    retiredRefresh.controller.abort();
    if (inFlightRefresh === retiredRefresh) {
        inFlightRefresh = null;
        state.isCheckingPRs = false;
    }
}

export function activatePullRequestSession(): void {
    state.sessionGeneration += 1;
    state.sessionLocked = false;
    retireInFlightRefresh();
    state.lastRefreshTime = 0;
    delete (globalThis as { _prTrackerLastManual?: number })
        ._prTrackerLastManual;
}

export function invalidatePullRequestSession(): void {
    state.sessionGeneration += 1;
    state.sessionLocked = true;
    retireInFlightRefresh();
}

export function resetPullRequestManagerStateForTests(): boolean {
    if (inFlightRefresh || state.isCheckingPRs) return false;

    resetPullRequestManagerStateAfterAccountReset();
    return true;
}

export function resetPullRequestManagerStateAfterAccountReset(): void {
    state.lastRefreshTime = 0;
    state.lastNewPRNotificationTime = 0;
    delete (globalThis as { _prTrackerLastManual?: number })
        ._prTrackerLastManual;
}

// Helper function to check if we should refresh
function shouldRefresh(): { shouldRefresh: boolean; remainingMs: number } {
    const now = Date.now();
    const elapsed = now - state.lastRefreshTime;
    const remainingMs = constants.REFRESH_INTERVAL - elapsed;
    if (elapsed >= constants.REFRESH_INTERVAL) {
        state.lastRefreshTime = now;
        return { shouldRefresh: true, remainingMs: 0 };
    }
    return { shouldRefresh: false, remainingMs: Math.max(0, remainingMs) };
}

export function checkPullRequests(
    isManualRefresh = false,
    customQueryFromMsg?: string | null
): Promise<void> {
    if (state.sessionLocked) {
        console.log('Session is locked, skipping PR check');
        return Promise.resolve();
    }

    const generation = state.sessionGeneration;
    if (inFlightRefresh?.generation === generation) {
        console.log('PR check already in progress, reusing it...');
        return inFlightRefresh.promise;
    }

    const controller = new AbortController();
    const refreshSession: RefreshSessionContext = {
        signal: controller.signal,
        isValid: () =>
            state.sessionGeneration === generation && !state.sessionLocked,
    };
    state.isCheckingPRs = true;
    const operation = runPullRequestCheck(
        isManualRefresh,
        customQueryFromMsg,
        refreshSession
    ).catch((error) => {
        if (isRefreshSessionInvalidated(error, refreshSession)) {
            console.log('PR check stopped because its session was invalidated');
            return;
        }
        throw error;
    });
    const trackedOperation = operation.finally(() => {
        if (inFlightRefresh?.promise === trackedOperation) {
            inFlightRefresh = null;
            state.isCheckingPRs = false;
        }
    });
    inFlightRefresh = { controller, generation, promise: trackedOperation };
    return trackedOperation;
}

async function runPullRequestCheck(
    isManualRefresh: boolean,
    customQueryFromMsg: string | null | undefined,
    refreshSession: RefreshSessionContext
): Promise<void> {
    console.log('Starting PR check');
    const sessionNotification = (
        id: string | undefined,
        options: {
            type: 'basic';
            iconUrl: string;
            title: string;
            message: string;
        },
        forceShow = false
    ) => {
        return createNotification(id, options, forceShow, refreshSession).then(
            () => undefined
        );
    };

    const activeCooldown = await getActiveGitHubRateLimitCooldown();
    assertRefreshSessionValid(refreshSession);
    if (activeCooldown) {
        if (isManualRefresh) {
            const resetTime = formatGitHubCooldownTime(
                activeCooldown.nextAllowedAt
            );
            browser.runtime.sendMessage({
                type: 'SHOW_ERROR',
                message: `GitHub rate limited until ${resetTime}. Showing cached pull requests.`,
            });
        }
        return;
    }

    // Additional rate limiting: prevent too frequent checks; throttle manual refreshes too
    if (!isManualRefresh && Date.now() - state.lastRefreshTime < 10000) {
        console.log('PR check rate limited - too soon since last AUTO check');
        return;
    }
    if (isManualRefresh) {
        const now = Date.now();
        // Initialize lastManualRefresh if not present (module-level var)
        const globalScope = globalThis as unknown as {
            _prTrackerLastManual: number;
        };
        if (typeof globalScope._prTrackerLastManual === 'undefined') {
            globalScope._prTrackerLastManual = 0;
        }
        const since = now - globalScope._prTrackerLastManual;
        if (since < 4000) {
            console.log(
                `Manual refresh throttled (${since}ms since last manual). Wait briefly before refreshing again.`
            );
            return;
        }
        globalScope._prTrackerLastManual = now;
    }

    try {
        assertRefreshSessionValid(refreshSession);
        // Only proceed if we have the password or can get it from session storage
        if (!state.sessionPassword) {
            const data = (await browser.storage.session.get([
                'sessionPassword',
            ])) as Record<string, unknown>;
            assertRefreshSessionValid(refreshSession);
            if (
                data.sessionPassword &&
                typeof data.sessionPassword === 'string'
            ) {
                state.sessionPassword = data.sessionPassword;
            } else {
                console.log(
                    'No session password available, cannot decrypt token'
                );
                // Notify user about missing session
                const errorMsg =
                    'Session expired or password missing. Please sign in again.';
                await createNotification(
                    undefined,
                    {
                        type: 'basic',
                        iconUrl: constants.NOTIFICATION_ICON,
                        title: 'PR Tracker Error',
                        message: errorMsg,
                    },
                    true,
                    refreshSession
                ); // Force show session errors
                assertRefreshSessionValid(refreshSession);
                browser.runtime.sendMessage({
                    type: 'SHOW_ERROR',
                    message: errorMsg,
                });
                return;
            }
        }

        // Continue only if enough time has passed since last refresh
        if (!isManualRefresh) {
            const refreshResult = shouldRefresh();
            if (!refreshResult.shouldRefresh) {
                const seconds = Math.ceil(refreshResult.remainingMs / 1000);
                console.log(
                    `Skipping refresh - too soon since last refresh (remaining: ${seconds}s)`
                );
                return;
            }
        }

        // Get the securely stored token
        if (!state.sessionPassword) {
            const errorMsg = 'Session password missing. Please sign in again.';
            await createNotification(
                undefined,
                {
                    type: 'basic',
                    iconUrl: constants.NOTIFICATION_ICON,
                    title: 'PR Tracker Error',
                    message: errorMsg,
                },
                true,
                refreshSession
            ); // Force show session errors
            assertRefreshSessionValid(refreshSession);
            browser.runtime.sendMessage({
                type: 'SHOW_ERROR',
                message: errorMsg,
            });
            return;
        }

        const sessionPassword = state.sessionPassword;
        const token = await decryptToken(sessionPassword);
        assertRefreshSessionValid(refreshSession);
        if (!token) {
            console.log(
                'Could not decrypt token - session may not be established yet'
            );
            return; // Silently return without showing error - user will authenticate when they open the popup
        }

        // Get user info
        const userResponse = await fetch('https://api.github.com/user', {
            signal: refreshSession.signal,
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        assertRefreshSessionValid(refreshSession);
        if (!userResponse.ok) {
            console.error(
                `User info fetch failed with status: ${userResponse.status}`
            );
            const errorInfo = await handleApiError(
                userResponse,
                sessionNotification,
                'User info fetch',
                refreshSession
            );
            assertRefreshSessionValid(refreshSession);
            if (errorInfo.rateLimit) {
                await persistGitHubRateLimitCooldown(errorInfo.rateLimit);
                assertRefreshSessionValid(refreshSession);
            }
            // Don't throw again if already handled - just return to stop execution
            return;
        }

        const user = await userResponse.json();
        assertRefreshSessionValid(refreshSession);

        // --- Custom Query Support ---
        let customQuery = customQueryFromMsg;
        if (typeof customQuery === 'undefined') {
            try {
                const encryptedData =
                    await decryptAppData<AppData>(sessionPassword);
                assertRefreshSessionValid(refreshSession);
                if (
                    encryptedData &&
                    encryptedData.preferences &&
                    encryptedData.preferences.customQuery
                ) {
                    customQuery = encryptedData.preferences.customQuery;
                }
            } catch (error) {
                if (isRefreshSessionInvalidated(error, refreshSession)) {
                    throw error;
                }
                console.log(
                    'Failed to get custom query from encrypted storage'
                );
            }
        }

        const result = await fetchPullRequests(
            token,
            user,
            customQuery || undefined,
            sessionNotification,
            refreshSession
        );
        assertRefreshSessionValid(refreshSession);
        if (result.status === 'failure') {
            if (result.rateLimit) {
                await persistGitHubRateLimitCooldown(result.rateLimit);
                assertRefreshSessionValid(refreshSession);
            }
            return;
        }
        const uniquePRs = result.pullRequests;

        if (result.rateLimit) {
            await persistGitHubRateLimitCooldown(result.rateLimit);
        } else {
            await clearGitHubRateLimitCooldown();
        }
        assertRefreshSessionValid(refreshSession);

        const count = uniquePRs.length;
        console.log(`Final count of unique PRs: ${count}`);
        assertRefreshSessionValid(refreshSession);
        await setBadgeText(count > 0 ? count.toString() : '');
        assertRefreshSessionValid(refreshSession);

        console.log('Saving PRs to storage');
        const refreshedData = await updateEncryptedAppData(
            sessionPassword,
            (appData) => {
                appData.pullRequests = uniquePRs;
                appData.lastUpdated = new Date().toISOString();
            },
            { isValid: refreshSession.isValid }
        );
        assertRefreshSessionValid(refreshSession);

        // Notify popup about data update
        try {
            assertRefreshSessionValid(refreshSession);
            await browser.runtime.sendMessage({
                type: 'DATA_UPDATED',
                timestamp: Date.now(),
            });
            assertRefreshSessionValid(refreshSession);
            console.log('Sent DATA_UPDATED message to popup');
        } catch (error) {
            if (isRefreshSessionInvalidated(error, refreshSession)) {
                throw error;
            }
            // Popup might not be open, which is fine
            console.log(
                'Could not send DATA_UPDATED message (popup may be closed)'
            );
        }

        // Handle notifications - check for new PRs
        const oldPrs = refreshedData.oldPullRequests ?? [];

        // Compare old and current PRs for new ones
        const oldPrIds = new Set(oldPrs.map((pr) => pr.id));
        const newPrs = uniquePRs.filter((pr) => !oldPrIds.has(pr.id));

        // Merge hidden status from decoupled storage (source of truth)
        let hiddenPrIds = new Set<number>();
        try {
            const ids = await decryptHiddenPrIds(sessionPassword);
            assertRefreshSessionValid(refreshSession);
            if (ids && ids.length > 0) {
                hiddenPrIds = new Set(ids);
            }
        } catch (error) {
            if (isRefreshSessionInvalidated(error, refreshSession)) {
                throw error;
            }
            console.error(
                'Failed to load hidden PR IDs from secure storage:',
                error
            );
        }

        uniquePRs.forEach((pr) => {
            if (hiddenPrIds.has(pr.id)) {
                pr.hidden = true;
            }
        });

        // Determine whether to notify on first run if enabled
        let notifyOnFirstRun = false;
        if (oldPrs.length === 0 && newPrs.length === uniquePRs.length) {
            // Check preference flag (default false)
            const pref = await browser.storage.local.get(
                'prtracker-notify-on-first-run'
            );
            assertRefreshSessionValid(refreshSession);
            notifyOnFirstRun = pref['prtracker-notify-on-first-run'] === true;
        }

        try {
            await advancePullRequestNotificationState(
                sessionPassword,
                uniquePRs,
                notifyOnFirstRun,
                refreshSession
            );
            assertRefreshSessionValid(refreshSession);
            console.log(
                'Updated oldPullRequests and pending notification state in encrypted storage'
            );
        } catch (error) {
            if (isRefreshSessionInvalidated(error, refreshSession)) {
                throw error;
            }
            console.error(
                'Failed to update oldPullRequests and pending notification state:',
                error
            );
            return;
        }

        await replayPendingPullRequestNotifications(
            sessionPassword,
            refreshSession
        );
        assertRefreshSessionValid(refreshSession);
    } catch (error) {
        if (isRefreshSessionInvalidated(error, refreshSession)) {
            console.log('PR check stopped because its session was invalidated');
            return;
        }
        console.error('Error checking pull requests:', error);
        const message =
            error instanceof Error
                ? error.message
                : 'Unknown error occurred while checking pull requests.';
        await createNotification(
            undefined,
            {
                type: 'basic',
                iconUrl: constants.NOTIFICATION_ICON,
                title: 'PR Tracker Error',
                message,
            },
            false,
            refreshSession
        );
        if (!refreshSession.isValid()) return;
        browser.runtime.sendMessage({ type: 'SHOW_ERROR', message });
    }
}
