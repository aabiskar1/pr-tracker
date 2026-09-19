import browser from 'webextension-polyfill';
import {
    decryptToken,
    decryptAppData,
    decryptHiddenPrIds,
} from '../services/secureStorage';
import type { PullRequest, AppData } from '../types';
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

let inFlightRefresh: Promise<void> | null = null;

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
    if (inFlightRefresh) {
        console.log('PR check already in progress, reusing it...');
        return inFlightRefresh;
    }

    state.isCheckingPRs = true;
    const operation = runPullRequestCheck(isManualRefresh, customQueryFromMsg);
    const trackedOperation = operation.finally(() => {
        if (inFlightRefresh === trackedOperation) {
            inFlightRefresh = null;
            state.isCheckingPRs = false;
        }
    });
    inFlightRefresh = trackedOperation;
    return trackedOperation;
}

async function runPullRequestCheck(
    isManualRefresh: boolean,
    customQueryFromMsg?: string | null
): Promise<void> {
    console.log('Starting PR check');

    const activeCooldown = await getActiveGitHubRateLimitCooldown();
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
            const errorInfo = await handleApiError(
                userResponse,
                createNotification,
                'User info fetch'
            );
            if (errorInfo.rateLimit) {
                await persistGitHubRateLimitCooldown(errorInfo.rateLimit);
            }
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

        const result = await fetchPullRequests(
            token,
            user,
            customQuery || undefined,
            createNotification
        );
        if (result.status === 'failure') {
            if (result.rateLimit) {
                await persistGitHubRateLimitCooldown(result.rateLimit);
            }
            return;
        }
        const uniquePRs = result.pullRequests;

        if (result.rateLimit) {
            await persistGitHubRateLimitCooldown(result.rateLimit);
        } else {
            await clearGitHubRateLimitCooldown();
        }

        const count = uniquePRs.length;
        console.log(`Final count of unique PRs: ${count}`);
        await setBadgeText(count > 0 ? count.toString() : '');

        console.log('Saving PRs to storage');
        const refreshedData = await updateEncryptedAppData(
            state.sessionPassword,
            (appData) => {
                appData.pullRequests = uniquePRs;
                appData.lastUpdated = new Date().toISOString();
            }
        );

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
        const oldPrs = refreshedData.oldPullRequests ?? [];

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
            const isNotificationThrottled =
                now - state.lastNewPRNotificationTime <
                constants.NOTIFICATION_THROTTLE_MS;

            if (!isNotificationThrottled) {
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
        }

        // Update oldPullRequests in storage AFTER notification logic
        try {
            await updateEncryptedAppData(state.sessionPassword, (appData) => {
                appData.oldPullRequests = uniquePRs;
            });
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
    }
}
