import browser from 'webextension-polyfill';
import { decryptAppData } from '../services/secureStorage';
import { state, constants } from './state';
import { AppData } from '../types';

const notificationThrottle = new Map<string, number>();

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
        if (now - lastShown < constants.NOTIFICATION_THROTTLE_MS) {
            console.log('Notification throttled:', options.title);
            return;
        }
        notificationThrottle.set(throttleKey, now);
        for (const [key, timestamp] of notificationThrottle.entries()) {
            if (now - timestamp > constants.NOTIFICATION_THROTTLE_MS * 2) {
                notificationThrottle.delete(key);
            }
        }

        const notificationOptions = {
            ...options,
            iconUrl: constants.NOTIFICATION_ICON,
        };
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
