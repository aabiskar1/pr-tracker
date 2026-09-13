import browser from 'webextension-polyfill';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyTheme,
    getStoredTheme,
    getSystemTheme,
    listenToSystemThemeChanges,
    setStoredTheme,
} from '../../src/services/themeManager';

const themeStorage = vi.hoisted(() => ({
    values: {} as Record<string, unknown>,
}));

vi.mock('webextension-polyfill', () => ({
    default: {
        storage: {
            local: {
                get: vi.fn(async (key: string) =>
                    Object.hasOwn(themeStorage.values, key)
                        ? { [key]: themeStorage.values[key] }
                        : {}
                ),
                set: vi.fn(async (values: Record<string, unknown>) => {
                    Object.assign(themeStorage.values, values);
                }),
            },
        },
    },
}));

describe('theme persistence', () => {
    const setAttribute = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn();

    beforeEach(() => {
        for (const key of Object.keys(themeStorage.values)) {
            delete themeStorage.values[key];
        }
        vi.clearAllMocks();
        setAttribute.mockReset();
        addEventListener.mockReset();
        removeEventListener.mockReset();
        matchMedia.mockReset();
        matchMedia.mockReturnValue({
            matches: false,
            addEventListener,
            removeEventListener,
        });
        vi.stubGlobal('document', {
            documentElement: { setAttribute },
        });
        vi.stubGlobal('window', { matchMedia });
    });

    it('defaults to automatic theme when the preference is missing', async () => {
        await expect(getStoredTheme()).resolves.toBe('auto');
        expect(browser.storage.local.get).toHaveBeenCalledWith(
            'theme-preference'
        );
    });

    it.each(['light', 'dark', 'auto'] as const)(
        'restores a valid persisted %s theme',
        async (theme) => {
            themeStorage.values['theme-preference'] = theme;

            await expect(getStoredTheme()).resolves.toBe(theme);
        }
    );

    it.each([null, 'sepia', 7, { theme: 'dark' }])(
        'falls back to automatic theme for invalid stored value %j',
        async (value) => {
            themeStorage.values['theme-preference'] = value;

            await expect(getStoredTheme()).resolves.toBe('auto');
        }
    );

    it('persists an explicit theme update under the current storage key', async () => {
        await setStoredTheme('dark');

        expect(browser.storage.local.set).toHaveBeenCalledWith({
            'theme-preference': 'dark',
        });
        expect(themeStorage.values['theme-preference']).toBe('dark');
    });

    it('applies explicit and automatic themes without testing CSS details', () => {
        applyTheme('dark');
        expect(setAttribute).toHaveBeenLastCalledWith('data-theme', 'dark');

        matchMedia.mockReturnValue({
            matches: true,
            addEventListener,
            removeEventListener,
        });
        applyTheme('auto');
        expect(setAttribute).toHaveBeenLastCalledWith('data-theme', 'dark');

        matchMedia.mockReturnValue({
            matches: false,
            addEventListener,
            removeEventListener,
        });
        expect(getSystemTheme()).toBe('light');
    });

    it('maps system theme change events to light and dark values', () => {
        const callback = vi.fn();

        listenToSystemThemeChanges(callback);
        const listener = addEventListener.mock.calls[0][1] as (event: {
            matches: boolean;
        }) => void;
        listener({ matches: true });
        listener({ matches: false });

        expect(callback.mock.calls).toEqual([['dark'], ['light']]);
    });
});
