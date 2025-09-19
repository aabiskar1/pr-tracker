// Background script for PR Tracker
import browser from 'webextension-polyfill';
import {
    decryptToken,
    encryptAppData,
    decryptAppData,
    hasEncryptionSetup,
} from '../services/secureStorage';

// Central notification icon (use packaged icon path, not root-relative)
const NOTIFICATION_ICON = 'icons/icon-128.png';

// Add types for GitHub API responses
type GitHubIssueSearchItem = {
    pull_request?: {
        url: string;
    };
};

type GitHubReview = {
    state: string;
    user: {
        id: number;
    };
};

type GitHubCheckRun = {
    conclusion: string | null;
    status: string;
};

type GitHubChecksResponse = {
    check_runs: GitHubCheckRun[];
};

type PullRequest = {
    id: number;
    title: string;
    html_url: string;
    repository: {
        name: string;
    };
    state: string;
    draft: boolean;
    created_at: string;
    requested_reviewers: { login: string; avatar_url: string }[];
    review_status?: 'approved' | 'changes-requested' | 'pending';
    ci_status?: 'passing' | 'failing' | 'pending';
    author?: { login: string; avatar_url: string };
};

// (Accidental duplicated fragment removed above)
// Core scheduling / session constants (restored after patch)
const ALARM_NAME = 'check-prs';
const CHECK_INTERVAL = 5; // minutes
const PASSWORD_EXPIRY_ALARM = 'password-expiry';
let sessionPassword: string | null = null;
let rememberPassword: boolean = false;
let lastRefreshTime: number = 0;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Add a flag to prevent multiple simultaneous PR checks
let isCheckingPRs: boolean = false;

// Notification throttling to prevent spam
const notificationThrottle = new Map<string, number>();
const NOTIFICATION_THROTTLE_MS = 30000; // 30 seconds

// Additional throttling for new PR notifications specifically
let lastNewPRNotificationTime = 0;

// Helper function to check if notifications are enabled
async function areNotificationsEnabled(): Promise<boolean> {
    const { 'prtracker-notifications-enabled': notificationsEnabled } =
        await browser.storage.local.get('prtracker-notifications-enabled');
    return notificationsEnabled !== false; // default true
}

// Centralized notification creator with throttling
async function createNotification(
    id: string | undefined,
    options: { type: 'basic'; iconUrl: string; title: string; message: string },
    forceShow: boolean = false
): Promise<void> {
    try {
        if (!forceShow && !(await areNotificationsEnabled())) {
            console.log(
                'Notifications disabled, skipping notification:',
                options.title
            );
            return;
        }

        const throttleKey =
            options.title === 'New Pull Requests'
                ? 'New Pull Requests'
                : `${options.title}:${options.message}`;
        const now = Date.now();
        const lastShown = notificationThrottle.get(throttleKey) || 0;
        if (now - lastShown < NOTIFICATION_THROTTLE_MS) {
            console.log('Notification throttled:', options.title);
            return;
        }
        notificationThrottle.set(throttleKey, now);
        for (const [key, timestamp] of notificationThrottle.entries()) {
            if (now - timestamp > NOTIFICATION_THROTTLE_MS * 2) {
                notificationThrottle.delete(key);
            }
        }

        const notificationOptions = { ...options, iconUrl: NOTIFICATION_ICON };
        console.log(
            'Creating notification',
            notificationOptions.title,
            'id=',
            id || '(auto)'
        );
        if (id) {
            await browser.notifications.create(id, notificationOptions);
        } else {
            await browser.notifications.create(notificationOptions);
        }
    } catch (error) {
        console.error('Failed to create notification:', error);
    }
}

// Enhanced error handling with richer differentiation between auth, rate limit, and other errors
async function analyzeHttpError(
    response: Response
): Promise<{ message: string; isRateLimit: boolean; isAuth: boolean }> {
    const status = response.status;
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    const rateLimitReset = response.headers.get('X-RateLimit-Reset');
    let body = '';
    try {
        body = await response.clone().text();
    } catch {
        /* ignore */
    }
    const lowerBody = body.toLowerCase();

    const isRateLimit =
        (status === 403 && rateLimitRemaining === '0') ||
        status === 429 ||
        lowerBody.includes('secondary rate limit') ||
        lowerBody.includes('abuse detection') ||
        lowerBody.includes('rate limit');
    if (isRateLimit) {
        const resetTime = rateLimitReset
            ? new Date(parseInt(rateLimitReset) * 1000)
            : null;
        const resetTimeStr = resetTime
            ? ` (resets at ${resetTime.toLocaleTimeString()})`
            : '';
        return {
            message: `GitHub API rate limit exceeded${resetTimeStr}. Please wait before trying again.`,
            isRateLimit: true,
            isAuth: false,
        };
    }

    if (status === 401) {
        return {
            message:
                'Authentication failed (401). Your GitHub token may have been revoked or expired. Re-enter password or reset to provide a new token.',
            isRateLimit: false,
            isAuth: true,
        };
    }

    if (status === 403) {
        return {
            message:
                'Access forbidden (403). Could be missing repo scope OR a temporary GitHub restriction. Try again later; if persistent, regenerate a token with repo scope.',
            isRateLimit: false,
            isAuth: false,
        };
    }

    if (status >= 500) {
        return {
            message: `GitHub servers are experiencing issues (${status}). Please try again later.`,
            isRateLimit: false,
            isAuth: false,
        };
    }

    if (status >= 400) {
        return {
            message: `Request failed with status ${status}. Please check your network connection and try again.`,
            isRateLimit: false,
            isAuth: false,
        };
    }

    return {
        message: `Unexpected error occurred (${status}). Please try again.`,
        isRateLimit: false,
        isAuth: false,
    };
}

// Helper function to handle API errors consistently
async function handleApiError(
    response: Response,
    context: string = 'API request'
): Promise<void> {
    const errorInfo = await analyzeHttpError(response);
    console.error(
        `${context} failed with status: ${response.status}`,
        errorInfo
    );

    // DO NOT automatically delete token; transient 403s / abuse limits were causing user token loss.
    await createNotification(
        undefined,
        {
            type: 'basic',
            iconUrl: NOTIFICATION_ICON,
            title: 'PR Tracker Error',
            message: errorInfo.message,
        },
        errorInfo.isAuth
    );

    browser.runtime.sendMessage({
        type: 'SHOW_ERROR',
        message: errorInfo.message,
    });
}

// Initialize the remembered password state when the service worker starts
const initializeRememberedPassword = async () => {
    try {
        const data = await browser.storage.session.get([
            'sessionPassword',
            'rememberPasswordFlag',
        ]);

        if (data.sessionPassword && data.rememberPasswordFlag) {
            sessionPassword = data.sessionPassword;
            rememberPassword = true;

            // Check if the password expiry alarm exists
            const alarms = await browser.alarms.getAll();
            const hasExpiryAlarm = alarms.some(
                (alarm) => alarm.name === PASSWORD_EXPIRY_ALARM
            );

            // If no expiry alarm, set one for 12 hours from now
            if (!hasExpiryAlarm) {
                const expiryTime = Date.now() + 12 * 60 * 60 * 1000;
                browser.alarms.create(PASSWORD_EXPIRY_ALARM, {
                    when: expiryTime,
                });
            }
        }
        // (no-op)
    } catch (error) {
        console.error('Error initializing remembered password:', error);
    }
};

// If encryption is enabled but encrypted PRs are not yet present, seed
// encrypted app data from any existing unencrypted cache. This avoids
// a temporary empty UI if the user is offline right after enabling encryption.
async function seedEncryptedAppDataFromUnencryptedIfNeeded() {
    try {
        const encryptionEnabled = await hasEncryptionSetup();
        if (!encryptionEnabled) return;
        if (!sessionPassword) return;

        // If we already have encrypted PRs, nothing to do
        try {
            const existing = await decryptAppData(sessionPassword);
            if (
                existing &&
                Array.isArray(existing.pullRequests) &&
                existing.pullRequests.length > 0
            ) {
                return;
            }
        } catch {
            // Decryption failed; we'll try to seed from unencrypted below
        }

        // Read any unencrypted cached PRs
        const unenc = await browser.storage.local.get([
            'pullRequests',
            'oldPullRequests',
            'prtracker-notifications-enabled',
            'prtracker-custom-query',
            'prtracker-filters',
            'prtracker-sort',
        ]);

        const cached = (unenc.pullRequests as unknown[]) || [];
        if (!Array.isArray(cached) || cached.length === 0) {
            return;
        }

        // Seed minimal app data with cached PRs and known preferences
        const appData = {
            pullRequests: cached,
            lastUpdated: new Date().toISOString(),
            preferences: {
                notificationsEnabled: unenc['prtracker-notifications-enabled'],
                customQuery: unenc['prtracker-custom-query'],
                filters: unenc['prtracker-filters'],
                sort: unenc['prtracker-sort'],
            },
            oldPullRequests: unenc.oldPullRequests || [],
        };

        await encryptAppData(appData, sessionPassword);
        console.log(
            'Seeded encrypted app data from existing unencrypted cache'
        );
    } catch (e) {
        console.warn(
            'Failed to seed encrypted app data from unencrypted cache:',
            e
        );
    }
}

// Initialize the extension
browser.runtime.onInstalled.addListener(async () => {
    console.log('PR Tracker extension installed');
    // Set up periodic checks
    browser.alarms.create(ALARM_NAME, {
        periodInMinutes: CHECK_INTERVAL,
    });

    // Initialize badge
    try {
        await browser.action.setBadgeBackgroundColor({ color: '#0D47A1' });
    } catch (e) {
        // Fallback for Firefox manifest v2
        await browser.browserAction.setBadgeBackgroundColor({
            color: '#0D47A1',
        });
    }

    // Initialize remembered password state
    await initializeRememberedPassword();
});

// Call initialization on service worker startup
initializeRememberedPassword();

// Handle alarm
browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        console.log('Checking PRs on alarm');
        // Only refresh if we have the password
        if (sessionPassword) {
            await checkPullRequests();
        } else if (rememberPassword) {
            // Try to get remembered password from storage
            const data = await browser.storage.session.get(['sessionPassword']);
            if (data.sessionPassword) {
                sessionPassword = data.sessionPassword;
                await checkPullRequests();
            }
        }
    } else if (alarm.name === PASSWORD_EXPIRY_ALARM) {
        // Clear the session password when expiry alarm triggers
        sessionPassword = null;
        rememberPassword = false;
        await browser.storage.session.remove([
            'sessionPassword',
            'rememberPasswordFlag',
        ]);
        // Clear the alarm
        await browser.alarms.clear(PASSWORD_EXPIRY_ALARM);
    }
});

// Helper function to set badge text cross-browser
async function setBadgeText(text: string) {
    try {
        // Try using Manifest V3 API first
        await browser.action.setBadgeText({ text });
    } catch (e) {
        // Fallback to Manifest V2 API for Firefox
        await browser.browserAction.setBadgeText({ text });
    }
}

// Helper function to check if we should refresh
function shouldRefresh(): { shouldRefresh: boolean; remainingMs: number } {
    const now = Date.now();
    const elapsed = now - lastRefreshTime;
    const remainingMs = REFRESH_INTERVAL - elapsed;
    if (elapsed >= REFRESH_INTERVAL) {
        lastRefreshTime = now;
        return { shouldRefresh: true, remainingMs: 0 };
    }
    return { shouldRefresh: false, remainingMs: Math.max(0, remainingMs) };
}

async function checkPullRequests(
    isManualRefresh = false,
    customQueryFromMsg?: string | null
) {
    console.log('Starting PR check');

    // Prevent multiple simultaneous checks
    if (isCheckingPRs && !isManualRefresh) {
        console.log('PR check already in progress, skipping...');
        return;
    }

    // Additional rate limiting: prevent too frequent checks; throttle manual refreshes too
    if (!isManualRefresh && Date.now() - lastRefreshTime < 10000) {
        console.log('PR check rate limited - too soon since last AUTO check');
        return;
    }
    if (isManualRefresh) {
        const now = Date.now();
        // Initialize lastManualRefresh if not present (module-level var)
        if (typeof (globalThis as any)._prTrackerLastManual === 'undefined') {
            (globalThis as any)._prTrackerLastManual = 0;
        }
        const since = now - (globalThis as any)._prTrackerLastManual;
        if (since < 4000) {
            console.log(
                `Manual refresh throttled (${since}ms since last manual). Wait briefly before refreshing again.`
            );
            return;
        }
        (globalThis as any)._prTrackerLastManual = now;
    }

    isCheckingPRs = true;

    try {
        // Only proceed if we have the password or can get it from session storage
        if (!sessionPassword) {
            const data = await browser.storage.session.get(['sessionPassword']);
            if (data.sessionPassword) {
                sessionPassword = data.sessionPassword;
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
                        iconUrl: '/icon.png',
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
        // Before proceeding, ensure encrypted cache is seeded from any prior unencrypted cache
        await seedEncryptedAppDataFromUnencryptedIfNeeded();
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
        if (!sessionPassword) {
            const errorMsg = 'Session password missing. Please sign in again.';
            await createNotification(
                undefined,
                {
                    type: 'basic',
                    iconUrl: '/icon.png',
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

        const token = await decryptToken(sessionPassword);
        if (!token) {
            const errorMsg =
                'Failed to decrypt your GitHub token. Please re-authenticate. If you keep seeing this error, logout and reset to setup a new token.';
            await createNotification(
                undefined,
                {
                    type: 'basic',
                    iconUrl: '/icon.png',
                    title: 'PR Tracker Error',
                    message: errorMsg,
                },
                true
            ); // Force show auth errors
            browser.runtime.sendMessage({
                type: 'SHOW_ERROR',
                message: errorMsg,
            });
            return;
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
            await handleApiError(userResponse, 'User info fetch');
            throw new Error(`Failed to get user info: ${userResponse.status}`);
        }

        const user = await userResponse.json();

        // --- Custom Query Support ---
        let customQuery = customQueryFromMsg;
        if (typeof customQuery === 'undefined') {
            // Try to get from encrypted storage first, then fallback to unencrypted
            try {
                const encryptedData = await decryptAppData(sessionPassword);
                if (
                    encryptedData &&
                    encryptedData.preferences &&
                    encryptedData.preferences.customQuery
                ) {
                    customQuery = encryptedData.preferences.customQuery;
                }
            } catch (error) {
                console.log(
                    'Failed to get custom query from encrypted storage, using unencrypted fallback'
                );
                // Fallback to unencrypted storage
                const data = await browser.storage.local.get([
                    'prtracker-custom-query',
                ]);
                if (data['prtracker-custom-query']) {
                    customQuery = data['prtracker-custom-query'];
                }
            }
        }

        let prItems: any[] = [];
        if (customQuery && customQuery.trim()) {
            // Use the custom query for a single search
            const customResp = await fetch(
                `https://api.github.com/search/issues?q=${encodeURIComponent(customQuery)}&per_page=100`,
                {
                    headers: {
                        Authorization: `token ${token}`,
                        Accept: 'application/vnd.github.v3+json',
                    },
                }
            );
            if (!customResp.ok) {
                console.error(
                    `Custom PR search failed. Status: ${customResp.status}`
                );
                await handleApiError(customResp, 'Custom PR search');
                throw new Error(`Failed to fetch PRs: ${customResp.status}`);
            }
            const customData = await customResp.json();
            prItems = customData.items || [];
        } else {
            // Default: Fetch both authored and review-requested PRs
            const searchQuery = `is:open is:pr author:${user.login} archived:false`;
            const assignedQuery = `is:open is:pr review-requested:${user.login} archived:false`;
            const [authoredResponse, reviewResponse] = await Promise.all([
                fetch(
                    `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
                    {
                        headers: {
                            Authorization: `token ${token}`,
                            Accept: 'application/vnd.github.v3+json',
                        },
                    }
                ),
                fetch(
                    `https://api.github.com/search/issues?q=${encodeURIComponent(assignedQuery)}&per_page=100`,
                    {
                        headers: {
                            Authorization: `token ${token}`,
                            Accept: 'application/vnd.github.v3+json',
                        },
                    }
                ),
            ]);
            if (!authoredResponse.ok || !reviewResponse.ok) {
                console.error(
                    `PR search failed. Authored status: ${authoredResponse.status}, Review status: ${reviewResponse.status}`
                );

                // Handle the first failing response
                const failedResponse = !authoredResponse.ok
                    ? authoredResponse
                    : reviewResponse;
                const context = !authoredResponse.ok
                    ? 'Authored PR search'
                    : 'Review PR search';
                await handleApiError(failedResponse, context);

                throw new Error(
                    `Failed to fetch PRs: ${authoredResponse.status}, ${reviewResponse.status}`
                );
            }

            const authoredData = await authoredResponse.json();
            const reviewData = await reviewResponse.json();
            prItems = [
                ...(authoredData.items || []),
                ...(reviewData.items || []),
            ];
        }

        // Get full PR details
        const getPRDetails = async (
            item: GitHubIssueSearchItem,
            token: string
        ) => {
            try {
                if (
                    !item.pull_request ||
                    typeof item.pull_request !== 'object' ||
                    !('url' in item.pull_request)
                ) {
                    console.error('Item missing pull_request URL');
                    return null;
                }

                const prUrl = item.pull_request.url as string;

                const [prData, reviewStatus, ciStatus] = await Promise.all([
                    fetch(prUrl, {
                        headers: {
                            Authorization: `token ${token}`,
                            Accept: 'application/vnd.github.v3+json',
                        },
                    }).then((r) => r.json()),
                    getReviewStatus(prUrl, token),
                    getCIStatus(prUrl, token),
                ]);

                return {
                    ...prData,
                    review_status: reviewStatus,
                    ci_status: ciStatus,
                };
            } catch (error) {
                console.error('Error fetching PR details:', error);
                return null;
            }
        };

        console.log('Fetching detailed PR information...');
        const detailedPRs = (
            await Promise.all(
                prItems.map((item: GitHubIssueSearchItem) =>
                    getPRDetails(item, token)
                )
            )
        ).filter(Boolean);

        // Combine and deduplicate PRs
        const allPRs = detailedPRs;

        // Map each PR to our simplified format, handling potential undefined properties safely
        const uniquePRs = Array.from(
            new Map(
                allPRs
                    .map((pr) => {
                        try {
                            // Create a safe repo name, handling the case where base.repo might be undefined
                            const repoName =
                                pr.base && pr.base.repo && pr.base.repo.name
                                    ? pr.base.repo.name
                                    : pr.repository && pr.repository.name
                                      ? pr.repository.name
                                      : pr.html_url.split('/')[4]; // Extract from URL as fallback

                            return [
                                pr.id,
                                {
                                    id: pr.id,
                                    title: pr.title || 'Untitled PR',
                                    html_url: pr.html_url,
                                    repository: {
                                        name: repoName,
                                    },
                                    state: pr.state || 'open',
                                    draft: pr.draft || false,
                                    created_at:
                                        pr.created_at ||
                                        new Date().toISOString(),
                                    requested_reviewers:
                                        pr.requested_reviewers || [],
                                    review_status: pr.review_status,
                                    ci_status: pr.ci_status,
                                    author: pr.user
                                        ? {
                                              login: pr.user.login,
                                              avatar_url: pr.user.avatar_url,
                                          }
                                        : undefined,
                                },
                            ];
                        } catch (err) {
                            console.error('Error processing PR:', err);
                            return null;
                        }
                    })
                    .filter(Boolean) as [number, PullRequest][]
            ).values()
        );

        const count = uniquePRs.length;
        console.log(`Final count of unique PRs: ${count}`);
        await setBadgeText(count > 0 ? count.toString() : '');

        console.log('Saving PRs to storage');

        // Get current app preferences to include in encrypted storage
        const currentPrefs = await browser.storage.local.get([
            'prtracker-notifications-enabled',
            'prtracker-custom-query',
            'prtracker-filters',
            'prtracker-sort',
            'oldPullRequests',
        ]);

        // Create app data object to encrypt
        const appData: any = {
            pullRequests: uniquePRs,
            lastUpdated: new Date().toISOString(),
            preferences: {
                notificationsEnabled:
                    currentPrefs['prtracker-notifications-enabled'],
                customQuery: currentPrefs['prtracker-custom-query'],
                filters: currentPrefs['prtracker-filters'],
                sort: currentPrefs['prtracker-sort'],
            },
            // Don't overwrite oldPullRequests here - let the notification logic handle it
            // This preserves the existing oldPullRequests for proper comparison
        };

        // Try to get existing encrypted data to preserve oldPullRequests
        try {
            const existingData = await decryptAppData(sessionPassword);
            if (existingData && existingData.oldPullRequests) {
                appData.oldPullRequests = existingData.oldPullRequests;
            } else {
                // If no existing oldPullRequests, initialize as empty array for first run
                appData.oldPullRequests = [];
            }
        } catch (error) {
            // If we can't decrypt existing data, initialize as empty for first run
            appData.oldPullRequests = [];
        }

        // Encrypt and store all app data
        await encryptAppData(appData, sessionPassword);

        // Also store unencrypted for backward compatibility only if encryption is not set up
        try {
            const encryptionEnabled = await hasEncryptionSetup();
            if (!encryptionEnabled) {
                await browser.storage.local.set({ pullRequests: uniquePRs });
            }
        } catch (e) {
            // In case of any issue determining encryption, do not write unencrypted
            console.warn(
                'Could not verify encryption setup; skipping unencrypted PR write'
            );
        }

        // Notify popup about data update
        try {
            await browser.runtime.sendMessage({
                type: 'DATA_UPDATED',
                timestamp: Date.now(),
            });
            console.log('Sent DATA_UPDATED message to popup');
        } catch (error) {
            // Popup might not be open, which is fine
            console.log(
                'Could not send DATA_UPDATED message (popup may be closed)'
            );
        }

        // Handle notifications - check for new PRs
        // Try to get old PRs from encrypted storage first, then fallback to unencrypted only if encryption not set up
        let oldPrs: PullRequest[] = [];
        let encryptedData: any = undefined;
        try {
            encryptedData = await decryptAppData(sessionPassword);
            if (encryptedData && encryptedData.oldPullRequests) {
                oldPrs = encryptedData.oldPullRequests;
            }
        } catch (error) {
            console.log('Failed to get old PRs from encrypted storage:', error);
            try {
                const encryptionEnabled = await hasEncryptionSetup();
                if (!encryptionEnabled) {
                    const fallbackData =
                        await browser.storage.local.get('oldPullRequests');
                    oldPrs = fallbackData.oldPullRequests || [];
                }
            } catch (e) {
                // If we cannot determine, prefer not to use unencrypted fallback
            }
        }

        // Compare old and current PRs for new ones
        const oldPrIds = new Set(oldPrs.map((pr: any) => pr.id));
        const newPrs = uniquePRs.filter((pr: any) => !oldPrIds.has(pr.id));
        // (debug logging removed)

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
            if (now - lastNewPRNotificationTime < NOTIFICATION_THROTTLE_MS) {
                return;
            }

            try {
                // Use undefined for ID to enable throttling based on title+message
                await createNotification(undefined, {
                    type: 'basic',
                    iconUrl: '/icon.png', // This works in both Chrome and Firefox
                    title: 'New Pull Requests',
                    message: `You have ${newPrs.length} new pull request${newPrs.length > 1 ? 's' : ''}!`,
                }); // Don't force - respect user preference for new PR notifications

                // Update the timestamp after successful notification
                lastNewPRNotificationTime = now;
            } catch (error) {
                console.error('Failed to send notification:', error);
            }
        } else {
            // No notification (either first run or no new PRs)
        }

        // Update oldPullRequests in storage AFTER notification logic
        // This ensures we use the correct old PRs for comparison next time
        try {
            // For encrypted storage, ensure we preserve the existing data structure
            let dataToSave: any;
            try {
                dataToSave = await decryptAppData(sessionPassword);
                if (!dataToSave) {
                    // Create proper structure if no existing data
                    dataToSave = {
                        pullRequests: uniquePRs,
                        lastUpdated: new Date().toISOString(),
                        preferences: {
                            notificationsEnabled:
                                currentPrefs['prtracker-notifications-enabled'],
                            customQuery: currentPrefs['prtracker-custom-query'],
                            filters: currentPrefs['prtracker-filters'],
                            sort: currentPrefs['prtracker-sort'],
                        },
                        oldPullRequests: uniquePRs, // Set to current PRs for next comparison
                    };
                } else {
                    // Update existing data
                    dataToSave.oldPullRequests = uniquePRs;
                }
            } catch (error) {
                console.log(
                    'Could not decrypt existing data, creating new structure'
                );
                // Create new structure if decryption fails
                dataToSave = {
                    pullRequests: uniquePRs,
                    lastUpdated: new Date().toISOString(),
                    preferences: {
                        notificationsEnabled:
                            currentPrefs['prtracker-notifications-enabled'],
                        customQuery: currentPrefs['prtracker-custom-query'],
                        filters: currentPrefs['prtracker-filters'],
                        sort: currentPrefs['prtracker-sort'],
                    },
                    oldPullRequests: uniquePRs,
                };
            }

            await encryptAppData(dataToSave, sessionPassword);
            console.log('Updated oldPullRequests in encrypted storage');

            // Debug: verify the save worked
            try {
                const verifyData = await decryptAppData(sessionPassword);
                const hasOldPRs =
                    verifyData &&
                    verifyData.oldPullRequests &&
                    verifyData.oldPullRequests.length > 0;
                console.log(
                    'Verified oldPullRequests saved:',
                    hasOldPRs ? 'yes' : 'none'
                );
            } catch (verifyError) {
                console.log(
                    'Failed to verify saved oldPullRequests:',
                    verifyError
                );
            }
        } catch (error) {
            console.error(
                'Failed to update oldPullRequests in encrypted storage:',
                error
            );
        }

        // Also update unencrypted storage if encryption is not set up
        try {
            const encryptionEnabled = await hasEncryptionSetup();
            if (!encryptionEnabled) {
                await browser.storage.local.set({
                    oldPullRequests: uniquePRs,
                });
                console.log('Updated oldPullRequests in unencrypted storage');
            }
        } catch (e) {
            console.error(
                'Failed to update oldPullRequests in unencrypted storage:',
                e
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
                iconUrl: '/icon.png',
                title: 'PR Tracker Error',
                message,
            },
            false
        );
        browser.runtime.sendMessage({ type: 'SHOW_ERROR', message });
    } finally {
        // Always reset the flag to allow future PR checks
        isCheckingPRs = false;
    }
}

async function getReviewStatus(
    prUrl: string,
    token: string
): Promise<'approved' | 'changes-requested' | 'pending'> {
    try {
        const response = await fetch(`${prUrl}/reviews`, {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        if (!response.ok) {
            console.error(`Failed to fetch review status: ${response.status}`);
            await handleApiError(response, 'Review status fetch');
            return 'pending';
        }

        const reviews = await response.json();

        // Get the latest review from each reviewer
        const latestReviews = new Map();
        reviews.forEach((review: GitHubReview) => {
            if (review.state && review.user) {
                latestReviews.set(review.user.id, review.state);
            }
        });

        const reviewStates = Array.from(latestReviews.values());

        if (reviewStates.includes('CHANGES_REQUESTED')) {
            return 'changes-requested';
        }
        if (
            reviewStates.length > 0 &&
            reviewStates.every((state) => state === 'APPROVED')
        ) {
            return 'approved';
        }
        return 'pending';
    } catch (error) {
        console.error('Error fetching review status:', error);
        const errorMsg =
            'Error fetching review status. Please check your network connection.';
        await createNotification(undefined, {
            type: 'basic',
            iconUrl: '/icon.png',
            title: 'PR Tracker Error',
            message: errorMsg,
        }); // Don't force - respect user preference for network errors
        browser.runtime.sendMessage({ type: 'SHOW_ERROR', message: errorMsg });
        return 'pending';
    }
}

async function getCIStatus(
    prUrl: string,
    token: string
): Promise<'passing' | 'failing' | 'pending'> {
    try {
        // The commits endpoint includes the combined status and check runs
        const response = await fetch(`${prUrl}/commits`, {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        if (!response.ok) {
            console.error(`Failed to fetch CI status: ${response.status}`);
            await handleApiError(response, 'CI status fetch');
            return 'pending';
        }

        const commits = await response.json();
        if (commits.length === 0) {
            return 'pending';
        }

        const lastCommit = commits[commits.length - 1];
        const statusUrl = lastCommit.url + '/status';
        const checksUrl = lastCommit.url + '/check-runs';

        const [statusResponse, checksResponse] = await Promise.all([
            fetch(statusUrl, {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            }),
            fetch(checksUrl, {
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            }),
        ]);

        const status = await statusResponse.json();
        const checks = (await checksResponse.json()) as GitHubChecksResponse;

        // No checks? Return pending
        if (checks.check_runs.length === 0) {
            return 'pending';
        }

        // Define failing and passing conclusion states
        const failingConclusions = [
            'failure',
            'cancelled',
            'timed_out',
            'action_required',
        ];

        // Check if any checks are explicitly failing
        const hasFailingChecks = checks.check_runs.some(
            (run) =>
                run.conclusion &&
                failingConclusions.includes(run.conclusion.toLowerCase())
        );

        if (status.state === 'failure' || hasFailingChecks) {
            return 'failing';
        }

        // Check for passing status
        // More permissive check: if status is success OR
        // all checks are completed AND none are failing
        if (
            status.state === 'success' ||
            (checks.check_runs.every((run) => run.status === 'completed') &&
                !hasFailingChecks)
        ) {
            return 'passing';
        }

        // If any check is in progress, consider the whole thing pending
        if (
            checks.check_runs.some(
                (run) => run.status === 'in_progress' || run.status === 'queued'
            )
        ) {
            return 'pending';
        }

        // Default case - if we get here, consider it pending
        return 'pending';
    } catch (error) {
        console.error('Error fetching CI status:', error);
        const errorMsg =
            'Error fetching CI status. Please check your network connection.';
        await createNotification(undefined, {
            type: 'basic',
            iconUrl: '/icon.png',
            title: 'PR Tracker Error',
            message: errorMsg,
        }); // Don't force - respect user preference for network errors
        browser.runtime.sendMessage({ type: 'SHOW_ERROR', message: errorMsg });
        return 'pending';
    }
}

// Patch the message handler to pass customQueryFromMsg
browser.runtime.onMessage.addListener(function (
    message: unknown,
    _sender: browser.Runtime.MessageSender,
    sendResponse: (response?: boolean | object) => void
): true {
    if (!message || typeof message !== 'object') {
        sendResponse(false);
        return true;
    }
    const typedMessage = message as Record<string, unknown>;
    if (typedMessage.type === 'CHECK_PRS') {
        if (
            typedMessage.password &&
            typeof typedMessage.password === 'string'
        ) {
            sessionPassword = typedMessage.password;
        }
        const isManualRefresh = typedMessage.manual === true;
        const customQueryFromMsg =
            typeof typedMessage.customQuery === 'string'
                ? typedMessage.customQuery
                : undefined;
        checkPullRequests(isManualRefresh, customQueryFromMsg)
            .then(() => {
                sendResponse(true);
            })
            .catch((error) => {
                console.error('Error checking PRs:', error);
                sendResponse(false);
            });
    } else if (typedMessage.type === 'SET_PASSWORD') {
        if (
            typedMessage.password &&
            typeof typedMessage.password === 'string'
        ) {
            // Store the password in memory
            sessionPassword = typedMessage.password;

            // Handle remember option
            if (typedMessage.remember === true) {
                rememberPassword = true;

                // Store BOTH password and flag in session storage
                browser.storage.session.set({
                    sessionPassword: typedMessage.password,
                    rememberPasswordFlag: true,
                });

                // Set up expiration alarm for 12 hours from now
                const expiryTime = Date.now() + 12 * 60 * 60 * 1000; // 12 hours in milliseconds
                browser.alarms.create(PASSWORD_EXPIRY_ALARM, {
                    when: expiryTime,
                });
            } else {
                rememberPassword = false;
                // Clear any existing storage and alarm
                browser.storage.session.remove([
                    'sessionPassword',
                    'rememberPasswordFlag',
                ]);
                browser.alarms.clear(PASSWORD_EXPIRY_ALARM);
            }

            // Set up periodic refresh
            browser.alarms.create(ALARM_NAME, {
                periodInMinutes: CHECK_INTERVAL,
            });

            // Proactively seed encrypted cache from any existing unencrypted cache
            seedEncryptedAppDataFromUnencryptedIfNeeded().catch(() => {
                /* no-op */
            });

            // Notify popup about authentication state change
            browser.runtime
                .sendMessage({
                    type: 'AUTH_STATE_CHANGED',
                    timestamp: Date.now(),
                })
                .then(() => {
                    console.log('Sent AUTH_STATE_CHANGED message to popup');
                })
                .catch(() => {
                    // Popup might not be open, which is fine
                    console.log(
                        'Could not send AUTH_STATE_CHANGED message (popup may be closed)'
                    );
                });

            sendResponse(true);
        } else {
            sendResponse(false);
        }
    } else if (typedMessage.type === 'GET_REMEMBERED_PASSWORD') {
        if (sessionPassword && rememberPassword) {
            sendResponse({
                hasRememberedPassword: true,
                password: sessionPassword,
            });
        } else {
            // Try to get from session storage
            browser.storage.session
                .get(['sessionPassword', 'rememberPasswordFlag'])
                .then((data) => {
                    if (data.sessionPassword && data.rememberPasswordFlag) {
                        sessionPassword = data.sessionPassword;
                        rememberPassword = true;
                        sendResponse({
                            hasRememberedPassword: true,
                            password: data.sessionPassword,
                        });
                    } else {
                        sendResponse({
                            hasRememberedPassword: false,
                        });
                    }
                });
        }
    } else if (typedMessage.type === 'CLEAR_SESSION') {
        sessionPassword = null;
        rememberPassword = false;
        // Clear session storage
        browser.storage.session.remove([
            'sessionPassword',
            'rememberPasswordFlag',
        ]);
        // Clear any expiry alarm
        browser.alarms.clear(PASSWORD_EXPIRY_ALARM);
        // Clear refresh alarm
        browser.alarms.clear(ALARM_NAME);
        sendResponse(true);
    } else if (typedMessage.type === 'POPUP_OPENED') {
        // Popup opened, send current data if we have a session
        if (sessionPassword) {
            // Send a data update message to refresh the popup
            browser.runtime
                .sendMessage({
                    type: 'DATA_UPDATED',
                    timestamp: Date.now(),
                })
                .catch(() => {
                    console.log('Could not send current data to popup');
                });
        }
        sendResponse(true);
    } else if (typedMessage.type === 'TEST_NOTIFICATION') {
        // Force a test notification irrespective of PR logic
        createNotification(
            undefined,
            {
                type: 'basic',
                iconUrl: NOTIFICATION_ICON,
                title: 'PR Tracker Test',
                message: 'This is a test notification trigger.',
            },
            true
        )
            .then(() => {
                console.log('[Notif] Test notification requested');
                sendResponse(true);
            })
            .catch((e) => {
                console.error('[Notif] Test notification failed', e);
                sendResponse(false);
            });
    } else if (typedMessage.type === 'ENABLE_FIRST_RUN_NOTIFICATION') {
        browser.storage.local
            .set({ 'prtracker-notify-on-first-run': true })
            .then(() => {
                console.log('[Notif] First-run notification enabled');
                sendResponse(true);
            });
    } else if (typedMessage.type === 'DISABLE_FIRST_RUN_NOTIFICATION') {
        browser.storage.local
            .set({ 'prtracker-notify-on-first-run': false })
            .then(() => {
                console.log('[Notif] First-run notification disabled');
                sendResponse(true);
            });
    } else {
        sendResponse(false);
    }
    return true;
});
