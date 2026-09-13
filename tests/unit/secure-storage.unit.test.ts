import browser from 'webextension-polyfill';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearSecureStorage,
    decryptAppData,
    decryptHiddenPrIds,
    decryptToken,
    encryptAppData,
    encryptHiddenPrIds,
    encryptToken,
    hasEncryptionSetup,
    hasStoredToken,
    removeToken,
    validatePassword,
} from '../../src/services/secureStorage';

const storageState = vi.hoisted(() => ({
    values: {} as Record<string, unknown>,
    getError: null as Error | null,
    setError: null as Error | null,
    removeError: null as Error | null,
}));

const selectStoredValues = (keys: string | string[]) => {
    const requestedKeys = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
        requestedKeys
            .filter((key) => Object.hasOwn(storageState.values, key))
            .map((key) => [key, storageState.values[key]])
    );
};

vi.mock('webextension-polyfill', () => ({
    default: {
        storage: {
            local: {
                get: vi.fn(async (keys: string | string[]) => {
                    if (storageState.getError) throw storageState.getError;
                    return selectStoredValues(keys);
                }),
                set: vi.fn(async (values: Record<string, unknown>) => {
                    if (storageState.setError) throw storageState.setError;
                    Object.assign(storageState.values, values);
                }),
                remove: vi.fn(async (keys: string | string[]) => {
                    if (storageState.removeError)
                        throw storageState.removeError;
                    for (const key of Array.isArray(keys) ? keys : [keys]) {
                        delete storageState.values[key];
                    }
                }),
            },
        },
        management: {
            getSelf: vi.fn(async () => ({ id: 'sanitized-extension-id' })),
        },
    },
}));

const PASSWORD = 'correct horse battery staple';
const TOKEN = 'ghp_sanitized_secret_token';

describe('secure storage', () => {
    beforeEach(() => {
        for (const key of Object.keys(storageState.values)) {
            delete storageState.values[key];
        }
        storageState.getError = null;
        storageState.setError = null;
        storageState.removeError = null;
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('encrypts the token without persisting plaintext and round-trips it with the correct password', async () => {
        await encryptToken(TOKEN, PASSWORD);

        expect(storageState.values.encryptedGithubToken).toEqual(
            expect.any(Array)
        );
        expect(storageState.values.prtracker_iv).toEqual(expect.any(Array));
        expect(storageState.values.prtracker_salt).toEqual(expect.any(Array));
        expect(storageState.values.encryptionTestVector).toEqual({
            data: expect.any(Array),
            iv: expect.any(Array),
        });
        expect(JSON.stringify(storageState.values)).not.toContain(TOKEN);
        await expect(decryptToken(PASSWORD)).resolves.toBe(TOKEN);
        await expect(validatePassword(PASSWORD)).resolves.toBe(true);
        await expect(hasStoredToken()).resolves.toBe(true);
        await expect(hasEncryptionSetup()).resolves.toBe(true);
    });

    it('does not decrypt a token or validate the encryption vector with an incorrect password', async () => {
        await encryptToken(TOKEN, PASSWORD);

        await expect(decryptToken('incorrect password')).resolves.toBeNull();
        await expect(validatePassword('incorrect password')).resolves.toBe(
            false
        );
    });

    it('returns the current empty-state fallbacks when encrypted values are missing', async () => {
        await expect(decryptToken(PASSWORD)).resolves.toBeNull();
        await expect(decryptAppData(PASSWORD)).resolves.toEqual({});
        await expect(decryptHiddenPrIds(PASSWORD)).resolves.toEqual([]);
        await expect(validatePassword(PASSWORD)).resolves.toBe(false);
        await expect(hasStoredToken()).resolves.toBe(false);
        await expect(hasEncryptionSetup()).resolves.toBe(false);
    });

    it('round-trips encrypted application data and its persisted preferences', async () => {
        const appData = {
            pullRequests: [],
            oldPullRequests: [],
            lastUpdated: '2026-01-02T03:04:05.000Z',
            preferences: {
                notificationsEnabled: false,
                customQuery: 'is:pr org:acme',
                filters: {
                    showDrafts: false,
                    showReady: true,
                    showHidden: true,
                    ageFilter: 'week',
                    reviewStatus: ['approved'],
                    ciStatus: ['passing'],
                },
                sort: 'oldest',
            },
        };

        await encryptAppData(appData, PASSWORD);

        expect(JSON.stringify(storageState.values)).not.toContain(
            'notificationsEnabled'
        );
        await expect(decryptAppData(PASSWORD)).resolves.toEqual(appData);
        await expect(decryptAppData('incorrect password')).resolves.toBeNull();
    });

    it('round-trips separately encrypted hidden PR IDs and rejects corrupt ciphertext safely', async () => {
        await encryptHiddenPrIds([7, 11, 42], PASSWORD);
        await expect(decryptHiddenPrIds(PASSWORD)).resolves.toEqual([
            7, 11, 42,
        ]);

        storageState.values.encryptedHiddenPrIds = [0, 1, 2];
        await expect(decryptHiddenPrIds(PASSWORD)).resolves.toEqual([]);
    });

    it('rejects malformed storage envelopes through the existing schemas', async () => {
        Object.assign(storageState.values, {
            encryptedGithubToken: 'plaintext-token',
            prtracker_iv: 'not-an-iv',
            encryptionTestVector: {
                data: 'not-bytes',
                iv: [],
            },
            encryptedAppData: { invalid: true },
            appDataIv: [],
            encryptedHiddenPrIds: ['not-a-number'],
            hiddenPrIdsIv: [],
        });

        await expect(hasStoredToken()).resolves.toBe(false);
        await expect(hasEncryptionSetup()).resolves.toBe(false);
        await expect(decryptToken(PASSWORD)).resolves.toBeNull();
        await expect(decryptAppData(PASSWORD)).resolves.toEqual({});
        await expect(decryptHiddenPrIds(PASSWORD)).resolves.toEqual([]);
    });

    it('normalizes secure write failures and handles decrypt read failures safely', async () => {
        storageState.setError = new Error('storage quota exceeded');

        await expect(encryptToken(TOKEN, PASSWORD)).rejects.toThrow(
            'Failed to securely store token'
        );
        await expect(
            encryptAppData({ pullRequests: [] }, PASSWORD)
        ).rejects.toThrow('Failed to securely store app data');
        await expect(encryptHiddenPrIds([1], PASSWORD)).rejects.toThrow(
            'Failed to securely store hidden PR IDs'
        );

        storageState.setError = null;
        storageState.getError = new Error('storage unavailable');

        await expect(decryptToken(PASSWORD)).resolves.toBeNull();
        await expect(decryptAppData(PASSWORD)).resolves.toBeNull();
        await expect(decryptHiddenPrIds(PASSWORD)).resolves.toEqual([]);
        await expect(hasStoredToken()).rejects.toThrow('storage unavailable');
    });

    it('removes only token material when removeToken is requested', async () => {
        Object.assign(storageState.values, {
            encryptedGithubToken: [1],
            prtracker_iv: [2],
            prtracker_salt: [3],
            encryptionTestVector: { data: [4], iv: [5] },
            encryptedAppData: [6],
            appDataIv: [7],
        });

        await removeToken();

        expect(browser.storage.local.remove).toHaveBeenCalledWith([
            'encryptedGithubToken',
            'prtracker_iv',
        ]);
        expect(storageState.values).toMatchObject({
            prtracker_salt: [3],
            encryptionTestVector: { data: [4], iv: [5] },
            encryptedAppData: [6],
            appDataIv: [7],
        });
        expect(storageState.values.encryptedGithubToken).toBeUndefined();
        expect(storageState.values.prtracker_iv).toBeUndefined();
    });

    it('clears credentials and encrypted app preferences while preserving current out-of-band theme and hidden-ID storage', async () => {
        Object.assign(storageState.values, {
            encryptedGithubToken: [1],
            prtracker_iv: [2],
            prtracker_salt: [3],
            encryptionTestVector: { data: [4], iv: [5] },
            encryptedAppData: [6],
            appDataIv: [7],
            encryptedHiddenPrIds: [8],
            hiddenPrIdsIv: [9],
            'theme-preference': 'dark',
        });

        await clearSecureStorage();

        expect(browser.storage.local.remove).toHaveBeenCalledWith([
            'encryptedGithubToken',
            'prtracker_iv',
            'encryptionTestVector',
            'prtracker_salt',
            'encryptedAppData',
            'appDataIv',
        ]);
        expect(storageState.values).toEqual({
            encryptedHiddenPrIds: [8],
            hiddenPrIdsIv: [9],
            'theme-preference': 'dark',
        });
    });
});
