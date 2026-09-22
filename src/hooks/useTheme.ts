import { useState, useEffect } from 'react';
import {
    getInitializedTheme,
    listenToSystemThemeChanges,
    setStoredTheme as setStoredThemeService,
    applyTheme,
    type ThemePreference,
} from '../services/themeManager';

export function useTheme() {
    const [theme, setTheme] = useState<ThemePreference>(getInitializedTheme);

    useEffect(() => {
        applyTheme(theme);
        if (theme !== 'auto') return;

        return listenToSystemThemeChanges(() => applyTheme('auto'));
    }, [theme]);

    const handleThemeChange = async (newTheme: ThemePreference) => {
        setTheme(newTheme);
        await setStoredThemeService(newTheme);
    };

    return { theme, handleThemeChange };
}
