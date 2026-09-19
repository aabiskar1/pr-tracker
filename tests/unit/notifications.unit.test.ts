import browser from 'webextension-polyfill';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            getURL: vi.fn((path: string) => `extension://${path}`),
        },
        notifications: {
            create: vi.fn(async () => 'notification-id'),
        },
        action: {
            setBadgeText: vi.fn(async () => undefined),
        },
        browserAction: {
            setBadgeText: vi.fn(async () => undefined),
        },
    },
}));

vi.mock('../../src/services/secureStorage', () => ({
    decryptAppData: vi.fn(),
}));

const loadNotifications = async () => {
    const notifications = await import('../../src/background/notifications');
    const { state, constants } = await import('../../src/background/state');
    const { decryptAppData } = await import('../../src/services/secureStorage');
    return { ...notifications, state, constants, decryptAppData };
};

const notification = (title: string, message = 'Message') => ({
    type: 'basic' as const,
    iconUrl: 'ignored-by-runtime.png',
    title,
    message,
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('background notification delivery', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-06-07T08:09:10.000Z'));
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('defaults notifications to enabled when there is no session password', async () => {
        const { areNotificationsEnabled, state, decryptAppData } =
            await loadNotifications();
        state.sessionPassword = null;

        await expect(areNotificationsEnabled()).resolves.toBe(true);
        expect(decryptAppData).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        'restores an explicit encrypted notification preference of %s',
        async (notificationsEnabled) => {
            const { areNotificationsEnabled, state, decryptAppData } =
                await loadNotifications();
            state.sessionPassword = 'active-password';
            vi.mocked(decryptAppData).mockResolvedValue({
                pullRequests: [],
                lastUpdated: '2030-06-07T08:09:10.000Z',
                preferences: { notificationsEnabled },
            });

            await expect(areNotificationsEnabled()).resolves.toBe(
                notificationsEnabled
            );
            expect(decryptAppData).toHaveBeenCalledWith('active-password');
        }
    );

    it.each([{}, { preferences: {} }, null])(
        'defaults notifications to enabled for missing preference data %#',
        async (appData) => {
            const { areNotificationsEnabled, state, decryptAppData } =
                await loadNotifications();
            state.sessionPassword = 'active-password';
            vi.mocked(decryptAppData).mockResolvedValue(appData);

            await expect(areNotificationsEnabled()).resolves.toBe(true);
        }
    );

    it('defaults notifications to enabled when encrypted preference loading fails', async () => {
        const { areNotificationsEnabled, state, decryptAppData } =
            await loadNotifications();
        state.sessionPassword = 'active-password';
        vi.mocked(decryptAppData).mockRejectedValue(
            new Error('storage unavailable')
        );

        await expect(areNotificationsEnabled()).resolves.toBe(true);
    });

    it('suppresses ordinary notifications when the encrypted preference is disabled', async () => {
        const { createNotification, state, decryptAppData } =
            await loadNotifications();
        state.sessionPassword = 'active-password';
        vi.mocked(decryptAppData).mockResolvedValue({
            preferences: { notificationsEnabled: false },
        });

        await createNotification(undefined, notification('New Pull Requests'));

        expect(browser.notifications.create).not.toHaveBeenCalled();
    });

    it('force-shows an error despite a disabled notification preference', async () => {
        const { createNotification, state, decryptAppData, constants } =
            await loadNotifications();
        state.sessionPassword = 'active-password';
        vi.mocked(decryptAppData).mockResolvedValue({
            preferences: { notificationsEnabled: false },
        });

        await createNotification(
            'session-error',
            notification('PR Tracker Error', 'Session expired'),
            true
        );

        expect(browser.notifications.create).toHaveBeenCalledWith(
            'session-error',
            {
                type: 'basic',
                iconUrl: `extension://${constants.NOTIFICATION_ICON}`,
                title: 'PR Tracker Error',
                message: 'Session expired',
            }
        );
        expect(decryptAppData).not.toHaveBeenCalled();
    });

    it('does not display a notification after its refresh session is invalidated', async () => {
        const { createNotification, state, decryptAppData } =
            await loadNotifications();
        const preference = deferred<{
            preferences: { notificationsEnabled: boolean };
        }>();
        state.sessionPassword = 'active-password';
        vi.mocked(decryptAppData).mockReturnValueOnce(preference.promise);
        const controller = new AbortController();
        let valid = true;
        const delivery = createNotification(
            undefined,
            notification('New Pull Requests'),
            false,
            { signal: controller.signal, isValid: () => valid }
        );
        await vi.waitFor(() => {
            expect(decryptAppData).toHaveBeenCalledOnce();
        });

        valid = false;
        controller.abort();
        preference.resolve({ preferences: { notificationsEnabled: true } });

        await expect(delivery).resolves.toBeUndefined();
        expect(browser.notifications.create).not.toHaveBeenCalled();
    });

    it('uses an automatic browser ID when no notification ID is supplied', async () => {
        const { createNotification } = await loadNotifications();

        await createNotification(undefined, notification('Build completed'));

        expect(browser.notifications.create).toHaveBeenCalledWith({
            type: 'basic',
            iconUrl: 'extension://icons/icon-128.png',
            title: 'Build completed',
            message: 'Message',
        });
    });

    it('deduplicates new-PR notifications by title during the throttle window', async () => {
        const { createNotification, constants } = await loadNotifications();

        await createNotification(
            undefined,
            notification('New Pull Requests', 'You have 1 new pull request!')
        );
        vi.advanceTimersByTime(constants.NOTIFICATION_THROTTLE_MS - 1);
        await createNotification(
            undefined,
            notification('New Pull Requests', 'You have 2 new pull requests!')
        );
        vi.advanceTimersByTime(1);
        await createNotification(
            undefined,
            notification('New Pull Requests', 'You have 3 new pull requests!')
        );

        expect(browser.notifications.create).toHaveBeenCalledTimes(2);
    });

    it('allows the first notification in a new test scenario after reset', async () => {
        const { createNotification, resetNotificationThrottleForTests } =
            await loadNotifications();

        await createNotification(
            undefined,
            notification('New Pull Requests', 'First scenario')
        );
        resetNotificationThrottleForTests();
        await createNotification(
            undefined,
            notification('New Pull Requests', 'Fresh scenario')
        );

        expect(browser.notifications.create).toHaveBeenCalledTimes(2);
    });

    it('deduplicates other notifications by their title and message', async () => {
        const { createNotification } = await loadNotifications();

        await createNotification(
            undefined,
            notification('PR Tracker Error', 'First error')
        );
        await createNotification(
            undefined,
            notification('PR Tracker Error', 'First error')
        );
        await createNotification(
            undefined,
            notification('PR Tracker Error', 'Second error')
        );

        expect(browser.notifications.create).toHaveBeenCalledTimes(2);
    });

    it('contains browser notification API rejection and retains its throttle', async () => {
        const { createNotification } = await loadNotifications();
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        vi.mocked(browser.notifications.create).mockRejectedValueOnce(
            new Error('Notification API unavailable')
        );

        await expect(
            createNotification(
                undefined,
                notification(
                    'New Pull Requests',
                    'You have 1 new pull request!'
                )
            )
        ).resolves.toBeUndefined();
        await createNotification(
            undefined,
            notification('New Pull Requests', 'You have 1 new pull request!')
        );

        expect(browser.notifications.create).toHaveBeenCalledOnce();
        expect(consoleError).toHaveBeenCalledWith(
            'Failed to create notification:',
            expect.objectContaining({ message: 'Notification API unavailable' })
        );
    });

    it('uses the Manifest V3 badge API when available', async () => {
        const { setBadgeText } = await loadNotifications();

        await setBadgeText('4');

        expect(browser.action.setBadgeText).toHaveBeenCalledWith({ text: '4' });
        expect(browser.browserAction.setBadgeText).not.toHaveBeenCalled();
    });

    it('falls back to the Firefox Manifest V2 badge API', async () => {
        const { setBadgeText } = await loadNotifications();
        vi.mocked(browser.action.setBadgeText).mockRejectedValueOnce(
            new Error('action API unavailable')
        );

        await setBadgeText('7');

        expect(browser.browserAction.setBadgeText).toHaveBeenCalledWith({
            text: '7',
        });
    });
});
