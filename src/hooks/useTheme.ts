import { useState, useEffect } from 'react';
import {
    getStoredTheme,
    setStoredTheme as setStoredThemeService,
    applyTheme,
    ThemePreference,
} from '../services/themeManager';

export function useTheme() {
    const [theme, setTheme] = useState<ThemePreference>('auto');

    useEffect(() => {
        let mediaQuery: MediaQueryList | null = null;
        let handler: ((e: MediaQueryListEvent) => void) | null = null;
        getStoredTheme().then((storedTheme) => {
            setTheme(storedTheme);
            applyTheme(storedTheme);
            if (storedTheme === 'auto') {
                mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                handler = () => applyTheme('auto');
                mediaQuery.addEventListener('change', handler);
            }
        });

        return () => {
            if (mediaQuery && handler)
                mediaQuery.removeEventListener('change', handler);
        };
    }, []);

    const handleThemeChange = async (newTheme: ThemePreference) => {
        setTheme(newTheme);
        await setStoredThemeService(newTheme);
        applyTheme(newTheme);
    };

    return { theme, handleThemeChange };
}
