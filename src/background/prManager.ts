import browser from 'webextension-polyfill';
import {
    decryptToken,
    decryptAppData,
    encryptAppData,
    decryptHiddenPrIds,
} from '../services/secureStorage';
import { PullRequest, AppData, AppPreferences } from '../types';
import { fetchPullRequests, handleApiError } from './api';
import { createNotification, setBadgeText } from './notifications';
import { state, constants } from './state';

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

export async function checkPullRequests(
    isManualRefresh = false,
    customQueryFromMsg?: string | null
) {
    console.log('Starting PR check');

    // Prevent multiple simultaneous checks
    if (state.isCheckingPRs && !isManualRefresh) {
        console.log('PR check already in progress, skipping...');
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

    state.isCheckingPRs = true;

    try {
        // Only proceed if we have the password or can get it from session storage
        if (!state.sessionPassword) {
            const data = (await browser.storage.session.get([
                'sessionPassword',
            ])) as Record<string, unknown>;
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
                    true
                ); // Force show session errors
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
                true
            ); // Force show session errors
            browser.runtime.sendMessage({
                type: 'SHOW_ERROR',
                message: errorMsg,
            });
            return;
        }

        const token = await decryptToken(state.sessionPassword);
        if (!token) {
            console.log(
                'Could not decrypt token - session may not be established yet'
            );
            return; // Silently return without showing error - user will authenticate when they open the popup
        }

        // Get user info
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        if (!userResponse.ok) {
            console.error(
                `User info fetch failed with status: ${userResponse.status}`
            );
            await handleApiError(
                userResponse,
                createNotification,
                'User info fetch'
            );
            // Don't throw again if already handled - just return to stop execution
            return;
        }

        const user = await userResponse.json();

        // --- Custom Query Support ---
        let customQuery = customQueryFromMsg;
        if (typeof customQuery === 'undefined') {
            try {
                const encryptedData = await decryptAppData<AppData>(
                    state.sessionPassword
                );
                if (
                    encryptedData &&
                    encryptedData.preferences &&
                    encryptedData.preferences.customQuery
                ) {
                    customQuery = encryptedData.preferences.customQuery;
                }
            } catch {
                console.log(
                    'Failed to get custom query from encrypted storage'
                );
            }
        }

        const uniquePRs = await fetchPullRequests(
            token,
            user,
            customQuery || undefined,
            createNotification
        );

        const count = uniquePRs.length;
        console.log(`Final count of unique PRs: ${count}`);
        await setBadgeText(count > 0 ? count.toString() : '');

        console.log('Saving PRs to storage');

        // Get current app preferences from encrypted storage
        let preferences: AppPreferences = {};
        try {
            const existingData = await decryptAppData<AppData>(
                state.sessionPassword
            );
            if (existingData && existingData.preferences) {
                preferences = existingData.preferences;
            }
        } catch {
            console.log(
                'Failed to load existing preferences from encrypted storage'
            );
        }

        // Create app data object to encrypt
        const appData: AppData = {
            pullRequests: uniquePRs,
            lastUpdated: new Date().toISOString(),
            preferences: preferences,
        };

        // Try to preserve oldPullRequests
        try {
            const existingData = await decryptAppData<AppData>(
                state.sessionPassword
            );
            if (existingData && existingData.oldPullRequests) {
                appData.oldPullRequests = existingData.oldPullRequests;
            } else {
                appData.oldPullRequests = [];
            }
        } catch {
            // If we can't decrypt existing data, initialize as empty for first run
            appData.oldPullRequests = [];
        }

        // Encrypt and store all app data
        await encryptAppData(appData, state.sessionPassword);

        // Notify popup about data update
        try {
            await browser.runtime.sendMessage({
                type: 'DATA_UPDATED',
                timestamp: Date.now(),
            });
            console.log('Sent DATA_UPDATED message to popup');
        } catch {
            // Popup might not be open, which is fine
            console.log(
                'Could not send DATA_UPDATED message (popup may be closed)'
            );
        }

        // Handle notifications - check for new PRs
        let oldPrs: PullRequest[] = [];
        let currentStoredPrs: PullRequest[] = [];
        try {
            const encryptedData = await decryptAppData<AppData>(
                state.sessionPassword
            );
            if (encryptedData && encryptedData.oldPullRequests) {
                oldPrs = encryptedData.oldPullRequests;
            }
            if (encryptedData && encryptedData.pullRequests) {
                currentStoredPrs = encryptedData.pullRequests;
            }
        } catch (error) {
            console.log('Failed to get old PRs from encrypted storage:', error);
        }

        // Compare old and current PRs for new ones
        const oldPrIds = new Set(oldPrs.map((pr: PullRequest) => pr.id));
        const newPrs = uniquePRs.filter(
            (pr: PullRequest) => !oldPrIds.has(pr.id)
        );

        // Merge hidden status from decoupled storage (source of truth)
        let hiddenPrIds = new Set<number>();
        try {
            const ids = await decryptHiddenPrIds(state.sessionPassword);
            if (ids && ids.length > 0) {
                hiddenPrIds = new Set(ids);
            }
        } catch (error) {
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
            notifyOnFirstRun = pref['prtracker-notify-on-first-run'] === true;
        }

        const shouldNotify =
            ((oldPrs.length > 0 && newPrs.length > 0) || notifyOnFirstRun) &&
            newPrs.length > 0;

        if (shouldNotify) {
            // Send new PR notification

            // Additional throttling for new PR notifications to prevent rapid-fire notifications
            const now = Date.now();
            if (
                now - state.lastNewPRNotificationTime <
                constants.NOTIFICATION_THROTTLE_MS
            ) {
                return;
            }

            try {
                // Use undefined for ID to enable throttling based on title+message
                await createNotification(undefined, {
                    type: 'basic',
                    iconUrl: constants.NOTIFICATION_ICON,
                    title: 'New Pull Requests',
                    message: `You have ${newPrs.length} new pull request${newPrs.length > 1 ? 's' : ''}!`,
                }); // Don't force - respect user preference for new PR notifications

                // Update the timestamp after successful notification
                state.lastNewPRNotificationTime = now;
            } catch (error) {
                console.error('Failed to send notification:', error);
            }
        }

        // Update oldPullRequests in storage AFTER notification logic
        try {
            let dataToSave: AppData;
            try {
                const decrypted = await decryptAppData<AppData>(
                    state.sessionPassword
                );
                if (!decrypted) {
                    dataToSave = {
                        pullRequests: uniquePRs,
                        lastUpdated: new Date().toISOString(),
                        preferences: preferences,
                        oldPullRequests: uniquePRs,
                    };
                } else {
                    dataToSave = decrypted as AppData;
                    dataToSave.oldPullRequests = uniquePRs;
                }
            } catch {
                console.log(
                    'Could not decrypt existing data, creating new structure'
                );
                dataToSave = {
                    pullRequests: uniquePRs,
                    lastUpdated: new Date().toISOString(),
                    preferences: preferences,
                    oldPullRequests: uniquePRs,
                };
            }

            await encryptAppData(dataToSave, state.sessionPassword);
            console.log('Updated oldPullRequests in encrypted storage');
        } catch (error) {
            console.error(
                'Failed to update oldPullRequests in encrypted storage:',
                error
            );
        }
    } catch (error) {
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
            false
        );
        browser.runtime.sendMessage({ type: 'SHOW_ERROR', message });
    } finally {
        state.isCheckingPRs = false;
    }
}
