import React from 'react';
import type { ThemePreference } from '../services/themeManager';

interface ThemeSwitcherProps {
    theme: ThemePreference;
    onThemeChange: (theme: ThemePreference) => void;
}

const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
    theme,
    onThemeChange,
}) => {
    return (
        <div className="flex items-center space-x-1">
            <select
                value={theme}
                onChange={(e) =>
                    onThemeChange(e.target.value as ThemePreference)
                }
                className="rounded border border-input bg-background px-2 py-1 text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                aria-label="Theme selector"
            >
                <option value="auto">Auto</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
            </select>
        </div>
    );
};

export default ThemeSwitcher;
