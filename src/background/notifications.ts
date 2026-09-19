import browser from 'webextension-polyfill';
import { decryptAppData } from '../services/secureStorage';
import { state, constants } from './state';
import type { AppData } from '../types';
import {
    assertRefreshSessionValid,
    isRefreshSessionInvalidated,
    type RefreshSessionContext,
} from './refreshSession';

const notificationThrottle = new Map<string, number>();

export type NotificationDeliveryResult =
    | 'displayed'
    | 'disabled'
    | 'throttled'
    | 'failed'
    | 'invalidated';

export function resetNotificationThrottleForTests(): void {
    notificationThrottle.clear();
}

// Helper function to check if notifications are enabled
export async function areNotificationsEnabled(): Promise<boolean> {
    if (!state.sessionPassword) {
        return true; // default true
    }

    try {
        const appData = await decryptAppData<AppData>(state.sessionPassword);
        if (
            appData &&
            appData.preferences &&
            typeof appData.preferences.notificationsEnabled === 'boolean'
        ) {
            return appData.preferences.notificationsEnabled;
        }
    } catch {
        console.log(
            'Failed to get notification preference from encrypted storage'
        );
    }

    return true; // default true
}

// Centralized notification creator with throttling
export async function createNotification(
    id: string | undefined,
    options: { type: 'basic'; iconUrl: string; title: string; message: string },
    forceShow: boolean = false,
    refreshSession?: RefreshSessionContext
): Promise<NotificationDeliveryResult> {
    try {
        assertRefreshSessionValid(refreshSession);
        if (!forceShow && !(await areNotificationsEnabled())) {
            assertRefreshSessionValid(refreshSession);
            console.log(
                'Notifications disabled, skipping notification:',
                options.title
            );
            return 'disabled';
        }
        assertRefreshSessionValid(refreshSession);

        const throttleKey =
            options.title === 'New Pull Requests'
                ? 'New Pull Requests'
                : `${options.title}:${options.message}`;
        const now = Date.now();
        const lastShown = notificationThrottle.get(throttleKey) || 0;
        if (now - lastShown < constants.NOTIFICATION_THROTTLE_MS) {
            console.log('Notification throttled:', options.title);
            return 'throttled';
        }
        notificationThrottle.set(throttleKey, now);
        for (const [key, timestamp] of notificationThrottle.entries()) {
            if (now - timestamp > constants.NOTIFICATION_THROTTLE_MS * 2) {
                notificationThrottle.delete(key);
            }
        }

        const notificationOptions = {
            ...options,
            iconUrl: browser.runtime.getURL(constants.NOTIFICATION_ICON),
        };
        console.log(
            'Creating notification',
            notificationOptions.title,
            'id=',
            id || '(auto)'
        );
        assertRefreshSessionValid(refreshSession);
        const createdId = id
            ? await browser.notifications.create(id, notificationOptions)
            : await browser.notifications.create(notificationOptions);
        try {
            assertRefreshSessionValid(refreshSession);
        } catch (error) {
            if (isRefreshSessionInvalidated(error, refreshSession)) {
                notificationThrottle.delete(throttleKey);
                try {
                    await browser.notifications.clear(createdId);
                } catch (clearError) {
                    console.error(
                        'Failed to clear notification from an invalidated session:',
                        clearError
                    );
                }
                return 'invalidated';
            }
            throw error;
        }
        return 'displayed';
    } catch (error) {
        if (isRefreshSessionInvalidated(error, refreshSession)) {
            return 'invalidated';
        }
        console.error('Failed to create notification:', error);
        return 'failed';
    }
}

// Helper function to set badge text cross-browser
export async function setBadgeText(text: string) {
    try {
        // Try using Manifest V3 API first
        await browser.action.setBadgeText({ text });
    } catch {
        // Fallback to Manifest V2 API for Firefox
        await browser.browserAction.setBadgeText({ text });
    }
}
