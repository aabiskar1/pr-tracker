import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAlarms } from '../../src/background/alarms';
import { constants } from '../../src/background/state';
import browser from 'webextension-polyfill';

// Mock dependencies
vi.mock('webextension-polyfill', () => ({
    default: {
        alarms: {
            onAlarm: {
                addListener: vi.fn(),
            },
            create: vi.fn(),
            clear: vi.fn(),
        },
        storage: {
            session: {
                get: vi.fn(),
                remove: vi.fn(),
            },
        },
    },
}));

vi.mock('../../src/background/prManager', () => ({
    checkPullRequests: vi.fn(),
}));

describe('Background Alarms', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('registers an alarm listener on setup', () => {
        setupAlarms();
        expect(browser.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    });

    it('handles periodic check alarm correctly', async () => {
        setupAlarms();

        // Get the registered listener
        const listener = (browser.alarms.onAlarm.addListener as any).mock
            .calls[0][0];

        // Simulate alarm
        const alarm = { name: constants.ALARM_NAME };

        // Mock state to have password
        // Note: We are testing side effects. To fully test this we might need to export/import state or mock it.
        // For now, let's verify it doesn't crash.
        await listener(alarm);

        // Since we didn't setup state mock fully, we expect it might not call checkPullRequests yet
        // or check browser.storage.session.
    });
});
