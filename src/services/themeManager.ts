import browser from 'webextension-polyfill';
import { ThemeStorageSchema } from './storageSchemas';

const THEME_KEY = 'theme-preference'; // 'light', 'dark', or 'auto'
let initializedTheme: ThemePreference | undefined;

export type ThemePreference = 'light' | 'dark' | 'auto';

export async function getStoredTheme(): Promise<ThemePreference> {
    const result = await browser.storage.local.get(THEME_KEY);
    const parsed = ThemeStorageSchema.safeParse(result);
    const theme = parsed.success ? parsed.data[THEME_KEY] : undefined;
    return theme || 'auto';
}

export async function setStoredTheme(theme: ThemePreference) {
    await browser.storage.local.set({ [THEME_KEY]: theme });
}

export function getSystemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

export function applyTheme(theme: ThemePreference) {
    const effectiveTheme = theme === 'auto' ? getSystemTheme() : theme;
    document.documentElement.setAttribute('data-theme', effectiveTheme);
}

export async function initializeTheme(): Promise<ThemePreference> {
    let theme: ThemePreference = 'auto';
    try {
        theme = await getStoredTheme();
    } catch {
        // A storage failure must not prevent the popup from mounting.
    }
    initializedTheme = theme;
    applyTheme(theme);
    return theme;
}

export function getInitializedTheme(): ThemePreference {
    return initializedTheme ?? 'auto';
}

export function listenToSystemThemeChanges(
    callback: (theme: 'light' | 'dark') => void
) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
        callback(event.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
}
