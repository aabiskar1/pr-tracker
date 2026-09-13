import browser from 'webextension-polyfill';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupAlarms } from '../../src/background/alarms';
import { constants, state } from '../../src/background/state';
import { checkPullRequests } from '../../src/background/prManager';

vi.mock('webextension-polyfill', () => ({
    default: {
        alarms: {
            onAlarm: { addListener: vi.fn() },
            create: vi.fn(),
            clear: vi.fn(async () => true),
        },
        storage: {
            session: {
                get: vi.fn(async () => ({})),
                remove: vi.fn(async () => undefined),
            },
        },
    },
}));

vi.mock('../../src/background/prManager', () => ({
    checkPullRequests: vi.fn(async () => undefined),
}));

const registeredAlarmListener = () =>
    vi.mocked(browser.alarms.onAlarm.addListener).mock.calls[0][0];

describe('remembered-password alarm behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.sessionPassword = null;
        state.rememberPassword = false;
        vi.mocked(browser.storage.session.get).mockResolvedValue({});
    });

    it('clears remembered session state when the expiry alarm fires', async () => {
        state.sessionPassword = 'remembered-password';
        state.rememberPassword = true;
        setupAlarms();

        await registeredAlarmListener()({
            name: constants.PASSWORD_EXPIRY_ALARM,
        });

        expect(state.sessionPassword).toBeNull();
        expect(state.rememberPassword).toBe(false);
        expect(browser.storage.session.remove).toHaveBeenCalledWith([
            'sessionPassword',
            'rememberPasswordFlag',
        ]);
        expect(browser.alarms.clear).toHaveBeenCalledWith(
            constants.PASSWORD_EXPIRY_ALARM
        );
    });

    it('uses an in-memory password for a periodic refresh', async () => {
        state.sessionPassword = 'active-password';
        setupAlarms();

        await registeredAlarmListener()({ name: constants.ALARM_NAME });

        expect(checkPullRequests).toHaveBeenCalledOnce();
        expect(browser.storage.session.get).not.toHaveBeenCalled();
    });

    it('restores a valid remembered password before a periodic refresh', async () => {
        state.rememberPassword = true;
        vi.mocked(browser.storage.session.get).mockResolvedValue({
            sessionPassword: 'stored-password',
        });
        setupAlarms();

        await registeredAlarmListener()({ name: constants.ALARM_NAME });

        expect(browser.storage.session.get).toHaveBeenCalledWith([
            'sessionPassword',
        ]);
        expect(state.sessionPassword).toBe('stored-password');
        expect(checkPullRequests).toHaveBeenCalledOnce();
    });

    it.each([{}, { sessionPassword: 42 }, { sessionPassword: null }])(
        'does not refresh from missing or malformed remembered password %#',
        async (stored) => {
            state.rememberPassword = true;
            vi.mocked(browser.storage.session.get).mockResolvedValue(stored);
            setupAlarms();

            await registeredAlarmListener()({ name: constants.ALARM_NAME });

            expect(state.sessionPassword).toBeNull();
            expect(checkPullRequests).not.toHaveBeenCalled();
        }
    );
});
