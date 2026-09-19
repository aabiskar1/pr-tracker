// Background script for PR Tracker
import browser from 'webextension-polyfill';
import { state, constants } from '@/src/background/state';
import {
    activatePullRequestSession,
    checkPullRequests,
    invalidatePullRequestSession,
    resetPullRequestManagerStateForTests,
} from '@/src/background/prManager';
import { resetNotificationThrottleForTests } from '@/src/background/notifications';
import { setupAlarms, createPeriodicAlarm } from '@/src/background/alarms';
import {
    applyAppDataMutation,
    parseAppDataMutation,
    waitForAppDataMutations,
} from '@/src/background/appDataStore';
import { SessionStorageSchema } from '@/src/services/storageSchemas';

export default defineBackground(() => {
    // Initialize the remembered password state when the service worker starts
    const initializeRememberedPassword = async () => {
        const generation = state.sessionGeneration;
        try {
            const result = await browser.storage.session.get([
                'sessionPassword',
                'rememberPasswordFlag',
            ]);
            const parsed = SessionStorageSchema.safeParse(result);

            if (state.sessionGeneration !== generation || state.sessionLocked) {
                return;
            }

            if (
                parsed.success &&
                parsed.data.sessionPassword &&
                parsed.data.rememberPasswordFlag
            ) {
                state.sessionPassword = parsed.data.sessionPassword;
                state.rememberPassword = true;

                // Check if the password expiry alarm exists
                const alarms = await browser.alarms.getAll();
                if (
                    state.sessionGeneration !== generation ||
                    state.sessionLocked
                ) {
                    return;
                }
                const hasExpiryAlarm = alarms.some(
                    (alarm) => alarm.name === constants.PASSWORD_EXPIRY_ALARM
                );

                // If no expiry alarm, set one for 12 hours from now
                if (!hasExpiryAlarm) {
                    const expiryTime = Date.now() + 12 * 60 * 60 * 1000;
                    browser.alarms.create(constants.PASSWORD_EXPIRY_ALARM, {
                        when: expiryTime,
                    });
                }
            }
        } catch (error) {
            console.error('Error initializing remembered password:', error);
        }
    };

    // Initialize the extension
    browser.runtime.onInstalled.addListener(async () => {
        console.log('PR Tracker extension installed');
        // Set up periodic checks
        createPeriodicAlarm();

        // Initialize badge
        try {
            await browser.action.setBadgeBackgroundColor({ color: '#0D47A1' });
        } catch {
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

    // Setup alarms
    setupAlarms();

    // Message Handler
    browser.runtime.onMessage.addListener(function (
        message: unknown,
        _sender: unknown,
        sendResponse: (response?: boolean | object) => void
    ): true {
        if (!message || typeof message !== 'object') {
            sendResponse(false);
            return true;
        }
        const typedMessage = message as Record<string, unknown>;

        if (typedMessage.type === 'CHECK_PRS') {
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
        } else if (typedMessage.type === 'UPDATE_APP_DATA') {
            const mutation = parseAppDataMutation(typedMessage.mutation);
            if (!state.sessionPassword || !mutation) {
                sendResponse(false);
            } else {
                applyAppDataMutation(state.sessionPassword, mutation)
                    .then(() => {
                        sendResponse(true);
                    })
                    .catch((error) => {
                        console.error('Failed to update app data:', error);
                        sendResponse(false);
                    });
            }
        } else if (typedMessage.type === 'SET_PASSWORD') {
            if (
                typedMessage.password &&
                typeof typedMessage.password === 'string'
            ) {
                activatePullRequestSession();
                // Store the password in memory
                state.sessionPassword = typedMessage.password;

                // Handle remember option
                if (typedMessage.remember === true) {
                    state.rememberPassword = true;

                    // Store BOTH password and flag in session storage
                    browser.storage.session.set({
                        sessionPassword: typedMessage.password,
                        rememberPasswordFlag: true,
                    });

                    // Set up expiration alarm for 12 hours from now
                    const expiryTime = Date.now() + 12 * 60 * 60 * 1000; // 12 hours in milliseconds
                    browser.alarms.create(constants.PASSWORD_EXPIRY_ALARM, {
                        when: expiryTime,
                    });
                } else {
                    state.rememberPassword = false;
                    // Clear any existing storage and alarm
                    browser.storage.session.remove([
                        'sessionPassword',
                        'rememberPasswordFlag',
                    ]);
                    browser.alarms.clear(constants.PASSWORD_EXPIRY_ALARM);
                }

                // Set up periodic refresh
                createPeriodicAlarm();

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
            if (state.sessionPassword && state.rememberPassword) {
                sendResponse({
                    hasRememberedPassword: true,
                    password: state.sessionPassword,
                });
            } else {
                // Try to get from session storage
                const generation = state.sessionGeneration;
                browser.storage.session
                    .get(['sessionPassword', 'rememberPasswordFlag'])
                    .then((result) => {
                        if (
                            state.sessionGeneration !== generation ||
                            state.sessionLocked
                        ) {
                            sendResponse({
                                hasRememberedPassword: false,
                            });
                            return;
                        }
                        const parsed = SessionStorageSchema.safeParse(result);
                        if (
                            parsed.success &&
                            parsed.data.sessionPassword &&
                            parsed.data.rememberPasswordFlag
                        ) {
                            state.sessionPassword = parsed.data.sessionPassword;
                            state.rememberPassword = true;
                            sendResponse({
                                hasRememberedPassword: true,
                                password: parsed.data.sessionPassword,
                            });
                        } else {
                            sendResponse({
                                hasRememberedPassword: false,
                            });
                        }
                    });
            }
        } else if (typedMessage.type === 'CLEAR_SESSION') {
            invalidatePullRequestSession();
            state.sessionPassword = null;
            state.rememberPassword = false;
            Promise.all([
                browser.storage.session.remove([
                    'sessionPassword',
                    'rememberPasswordFlag',
                ]),
                browser.alarms.clear(constants.PASSWORD_EXPIRY_ALARM),
                browser.alarms.clear(constants.ALARM_NAME),
                waitForAppDataMutations(),
            ])
                .then(() => sendResponse(true))
                .catch((error) => {
                    console.error('Failed to clear session:', error);
                    sendResponse(false);
                });
        } else if (
            import.meta.env.MODE === 'test' &&
            typedMessage.type === 'TEST_RESET_BACKGROUND_STATE'
        ) {
            const reset = resetPullRequestManagerStateForTests();
            if (reset) resetNotificationThrottleForTests();
            sendResponse(reset);
        } else if (typedMessage.type === 'POPUP_OPENED') {
            // Popup opened, send current data if we have a session
            if (state.sessionPassword) {
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
        } else if (typedMessage.type === 'ENABLE_FIRST_RUN_NOTIFICATION') {
            browser.storage.local
                .set({ 'prtracker-notify-on-first-run': true })
                .then(() => {
                    // preference enabled
                    sendResponse(true);
                });
        } else if (typedMessage.type === 'DISABLE_FIRST_RUN_NOTIFICATION') {
            browser.storage.local
                .set({ 'prtracker-notify-on-first-run': false })
                .then(() => {
                    // preference disabled
                    sendResponse(true);
                });
        } else {
            sendResponse(false);
        }
        return true;
    });
});
