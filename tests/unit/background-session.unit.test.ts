import browser from 'webextension-polyfill';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { constants } from '../../src/background/state';
import { createPeriodicAlarm } from '@/src/background/alarms';
import { checkPullRequests } from '@/src/background/prManager';
import {
    applyAppDataMutation,
    parseAppDataMutation,
} from '@/src/background/appDataStore';
import type { AppDataMutation } from '../../src/types';

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            onInstalled: { addListener: vi.fn() },
            onMessage: { addListener: vi.fn() },
            sendMessage: vi.fn(async () => undefined),
        },
        storage: {
            session: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => undefined),
                remove: vi.fn(async () => undefined),
            },
            local: {
                set: vi.fn(async () => undefined),
            },
        },
        alarms: {
            getAll: vi.fn(async () => []),
            create: vi.fn(),
            clear: vi.fn(async () => true),
        },
        action: {
            setBadgeBackgroundColor: vi.fn(async () => undefined),
        },
        browserAction: {
            setBadgeBackgroundColor: vi.fn(async () => undefined),
        },
    },
}));

vi.mock('@/src/background/prManager', () => ({
    checkPullRequests: vi.fn(async () => undefined),
}));

vi.mock('@/src/background/alarms', () => ({
    setupAlarms: vi.fn(),
    createPeriodicAlarm: vi.fn(),
}));

vi.mock('@/src/background/appDataStore', () => ({
    applyAppDataMutation: vi.fn(async () => undefined),
    parseAppDataMutation: vi.fn(),
}));

type MessageListener = (
    message: unknown,
    sender: unknown,
    sendResponse: (response?: boolean | object) => void
) => true;

const loadBackground = async () => {
    vi.stubGlobal('defineBackground', (initialize: () => void) => initialize());
    await import('../../entrypoints/background');
    return vi.mocked(browser.runtime.onMessage.addListener).mock
        .calls[0][0] as unknown as MessageListener;
};

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

describe('background remembered-session wiring', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-06-07T08:09:10.000Z'));
        vi.mocked(browser.storage.session.get).mockResolvedValue({});
        vi.mocked(browser.alarms.getAll).mockResolvedValue([]);
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue(undefined);
        vi.mocked(applyAppDataMutation).mockResolvedValue({
            pullRequests: [],
            oldPullRequests: [],
            lastUpdated: '2030-06-07T08:09:10.000Z',
            preferences: {},
        });
        vi.mocked(parseAppDataMutation).mockImplementation(
            (value) => value as AppDataMutation
        );
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        {
            label: 'without a timestamp',
            stored: {
                sessionPassword: 'remembered-password',
                rememberPasswordFlag: true,
            },
        },
        {
            label: 'with a malformed ignored timestamp',
            stored: {
                sessionPassword: 'remembered-password',
                rememberPasswordFlag: true,
                rememberedAt: 'not-a-date',
            },
        },
    ])(
        'restores a valid remembered session $label and creates a fresh 12-hour alarm',
        async ({ stored }) => {
            vi.mocked(browser.storage.session.get).mockResolvedValue(stored);
            await loadBackground();
            const { state } = await import('../../src/background/state');

            await vi.waitFor(() => {
                expect(state.sessionPassword).toBe('remembered-password');
                expect(state.rememberPassword).toBe(true);
            });
            expect(browser.alarms.create).toHaveBeenCalledWith(
                constants.PASSWORD_EXPIRY_ALARM,
                {
                    when:
                        new Date('2030-06-07T08:09:10.000Z').getTime() +
                        12 * 60 * 60 * 1000,
                }
            );
        }
    );

    it('does not recreate the expiry alarm when one already exists', async () => {
        vi.mocked(browser.storage.session.get).mockResolvedValue({
            sessionPassword: 'remembered-password',
            rememberPasswordFlag: true,
        });
        vi.mocked(browser.alarms.getAll).mockResolvedValue([
            { name: constants.PASSWORD_EXPIRY_ALARM },
        ]);
        await loadBackground();
        const { state } = await import('../../src/background/state');

        await vi.waitFor(() => {
            expect(state.sessionPassword).toBe('remembered-password');
        });
        expect(browser.alarms.create).not.toHaveBeenCalledWith(
            constants.PASSWORD_EXPIRY_ALARM,
            expect.anything()
        );
    });

    it.each([
        {},
        { sessionPassword: 'password-without-flag' },
        { sessionPassword: 42, rememberPasswordFlag: true },
        { sessionPassword: 'password', rememberPasswordFlag: 'yes' },
    ])(
        'rejects incomplete or malformed remembered state %#',
        async (stored) => {
            vi.mocked(browser.storage.session.get).mockResolvedValue(stored);
            await loadBackground();
            const { state } = await import('../../src/background/state');

            await vi.waitFor(() => {
                expect(browser.storage.session.get).toHaveBeenCalled();
            });
            expect(state.sessionPassword).toBeNull();
            expect(state.rememberPassword).toBe(false);
            expect(browser.alarms.create).not.toHaveBeenCalledWith(
                constants.PASSWORD_EXPIRY_ALARM,
                expect.anything()
            );
        }
    );

    it('stores remembered session state and schedules expiry exactly 12 hours after SET_PASSWORD', async () => {
        const listener = await loadBackground();
        const sendResponse = vi.fn();

        const result = listener(
            {
                type: 'SET_PASSWORD',
                password: 'remembered-password',
                remember: true,
            },
            {},
            sendResponse
        );
        const { state } = await import('../../src/background/state');

        expect(result).toBe(true);
        expect(state.sessionPassword).toBe('remembered-password');
        expect(state.rememberPassword).toBe(true);
        expect(browser.storage.session.set).toHaveBeenCalledWith({
            sessionPassword: 'remembered-password',
            rememberPasswordFlag: true,
        });
        expect(browser.alarms.create).toHaveBeenCalledWith(
            constants.PASSWORD_EXPIRY_ALARM,
            {
                when:
                    new Date('2030-06-07T08:09:10.000Z').getTime() +
                    12 * 60 * 60 * 1000,
            }
        );
        expect(createPeriodicAlarm).toHaveBeenCalledOnce();
        expect(sendResponse).toHaveBeenCalledWith(true);
    });

    it('routes a validated app-data mutation through the background owner', async () => {
        const listener = await loadBackground();
        const { state } = await import('../../src/background/state');
        state.sessionPassword = 'active-password';
        const sendResponse = vi.fn();
        const mutation: AppDataMutation = {
            kind: 'set-sort',
            sort: 'oldest',
        };

        listener({ type: 'UPDATE_APP_DATA', mutation }, {}, sendResponse);

        await vi.waitFor(() => {
            expect(sendResponse).toHaveBeenCalledWith(true);
        });
        expect(parseAppDataMutation).toHaveBeenCalledWith(mutation);
        expect(applyAppDataMutation).toHaveBeenCalledWith(
            'active-password',
            mutation
        );
    });

    it('answers CHECK_PRS only after the background refresh operation completes', async () => {
        const completion = deferred<void>();
        vi.mocked(checkPullRequests).mockReturnValueOnce(completion.promise);
        const listener = await loadBackground();
        const sendResponse = vi.fn();

        listener(
            {
                type: 'CHECK_PRS',
                password: 'active-password',
                manual: true,
                customQuery: 'is:pr org:acme',
            },
            {},
            sendResponse
        );

        expect(checkPullRequests).toHaveBeenCalledWith(true, 'is:pr org:acme');
        expect(sendResponse).not.toHaveBeenCalled();

        completion.resolve();
        await vi.waitFor(() => {
            expect(sendResponse).toHaveBeenCalledWith(true);
        });
    });

    it('rejects invalid or unauthenticated app-data mutation messages', async () => {
        const listener = await loadBackground();
        const { state } = await import('../../src/background/state');
        const sendResponse = vi.fn();
        vi.mocked(parseAppDataMutation).mockReturnValueOnce(null);

        listener(
            { type: 'UPDATE_APP_DATA', mutation: { kind: 'arbitrary' } },
            {},
            sendResponse
        );
        expect(sendResponse).toHaveBeenLastCalledWith(false);

        state.sessionPassword = null;
        listener(
            {
                type: 'UPDATE_APP_DATA',
                mutation: { kind: 'set-sort', sort: 'oldest' },
            },
            {},
            sendResponse
        );
        expect(sendResponse).toHaveBeenLastCalledWith(false);
        expect(applyAppDataMutation).not.toHaveBeenCalled();
    });

    it('keeps a non-remembered password only in memory and clears prior remembered state', async () => {
        const listener = await loadBackground();
        const sendResponse = vi.fn();

        listener(
            {
                type: 'SET_PASSWORD',
                password: 'memory-only-password',
                remember: false,
            },
            {},
            sendResponse
        );
        const { state } = await import('../../src/background/state');

        expect(state.sessionPassword).toBe('memory-only-password');
        expect(state.rememberPassword).toBe(false);
        expect(browser.storage.session.set).not.toHaveBeenCalled();
        expect(browser.storage.session.remove).toHaveBeenCalledWith([
            'sessionPassword',
            'rememberPasswordFlag',
        ]);
        expect(browser.alarms.clear).toHaveBeenCalledWith(
            constants.PASSWORD_EXPIRY_ALARM
        );
        expect(sendResponse).toHaveBeenCalledWith(true);
    });

    it('reads a valid remembered password from session storage on request', async () => {
        vi.mocked(browser.storage.session.get).mockResolvedValue({
            sessionPassword: 'stored-password',
            rememberPasswordFlag: true,
        });
        const listener = await loadBackground();
        const sendResponse = vi.fn();

        listener({ type: 'GET_REMEMBERED_PASSWORD' }, {}, sendResponse);

        await vi.waitFor(() => {
            expect(sendResponse).toHaveBeenCalledWith({
                hasRememberedPassword: true,
                password: 'stored-password',
            });
        });
    });

    it('clears memory, session storage, expiry, and refresh alarms for CLEAR_SESSION', async () => {
        const listener = await loadBackground();
        const { state } = await import('../../src/background/state');
        state.sessionPassword = 'active-password';
        state.rememberPassword = true;
        const sendResponse = vi.fn();

        listener({ type: 'CLEAR_SESSION' }, {}, sendResponse);

        expect(state.sessionPassword).toBeNull();
        expect(state.rememberPassword).toBe(false);
        expect(browser.storage.session.remove).toHaveBeenCalledWith([
            'sessionPassword',
            'rememberPasswordFlag',
        ]);
        expect(browser.alarms.clear).toHaveBeenCalledWith(
            constants.PASSWORD_EXPIRY_ALARM
        );
        expect(browser.alarms.clear).toHaveBeenCalledWith(constants.ALARM_NAME);
        expect(sendResponse).toHaveBeenCalledWith(true);
    });
});
