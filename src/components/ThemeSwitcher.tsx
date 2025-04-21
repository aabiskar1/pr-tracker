import React from 'react';
import { ThemePreference } from '../services/themeManager';

interface ThemeSwitcherProps {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ theme, onThemeChange }) => {
  return (
    <div className="flex items-center space-x-1">
      <select
        value={theme}
        onChange={e => onThemeChange(e.target.value as ThemePreference)}
        className="px-2 py-1 rounded border bg-white dark:bg-gray-700 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none"
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
