import browser from 'webextension-polyfill';
import { checkPullRequests } from './prManager';
import { state, constants } from './state';
import { SessionStorageSchema } from '../services/storageSchemas';

export function setupAlarms() {
    // Handle alarm
    browser.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name === constants.ALARM_NAME) {
            console.log('Checking PRs on alarm');
            // Only refresh if we have the password
            if (state.sessionPassword) {
                await checkPullRequests();
            } else if (state.rememberPassword) {
                // Try to get remembered password from storage
                const result = await browser.storage.session.get([
                    'sessionPassword',
                ]);
                const parsed = SessionStorageSchema.safeParse(result);
                if (parsed.success && parsed.data.sessionPassword) {
                    state.sessionPassword = parsed.data.sessionPassword;
                    await checkPullRequests();
                }
            }
        } else if (alarm.name === constants.PASSWORD_EXPIRY_ALARM) {
            // Clear the session password when expiry alarm triggers
            state.sessionPassword = null;
            state.rememberPassword = false;
            await browser.storage.session.remove([
                'sessionPassword',
                'rememberPasswordFlag',
            ]);
            // Clear the alarm
            await browser.alarms.clear(constants.PASSWORD_EXPIRY_ALARM);
        }
    });
}

export function createPeriodicAlarm() {
    browser.alarms.create(constants.ALARM_NAME, {
        periodInMinutes: constants.CHECK_INTERVAL,
    });
}
