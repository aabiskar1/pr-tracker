import React from 'react';
import { FaSync, FaSignOutAlt, FaSearch, FaCoffee } from 'react-icons/fa';
import { FilterBar, type FilterState, type SortOption } from './FilterBar';
import { PullRequestList } from './PullRequestList';
import ThemeSwitcher from './ThemeSwitcher';
import type { PullRequest, ThemePreference } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface DashboardProps {
    globalError: string;
    setGlobalError: (error: string) => void;
    theme: ThemePreference;
    handleThemeChange: (theme: ThemePreference) => void;
    notificationsEnabled: boolean;
    handleToggleNotifications: () => void;
    isLoading: boolean;
    refreshPullRequests: () => void;
    handleSignOut: () => void;
    filterState: FilterState;
    handleFilterChange: (filters: FilterState) => void;
    handleSortChange: (sort: SortOption) => void;
    handleResetFilters: () => void;
    sortOption: SortOption;
    customQueryInput: string;
    setCustomQueryInput: (input: string) => void;
    handleSaveCustomQuery: () => void;
    handleResetCustomQuery: () => void;
    isCustomQueryActive: boolean;
    customQuery: string;
    searchTerm: string;
    handleSearch: (e: React.ChangeEvent<HTMLInputElement>) => void;
    filteredPRs: PullRequest[];
    toggleHidePR: (id: number) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
    globalError,
    setGlobalError,
    theme,
    handleThemeChange,
    notificationsEnabled,
    handleToggleNotifications,
    isLoading,
    refreshPullRequests,
    handleSignOut,
    filterState,
    handleFilterChange,
    handleSortChange,
    handleResetFilters,
    sortOption,
    customQueryInput,
    setCustomQueryInput,
    handleSaveCustomQuery,
    handleResetCustomQuery,
    isCustomQueryActive,
    customQuery,
    searchTerm,
    handleSearch,
    filteredPRs,
    toggleHidePR,
}) => {
    return (
        <div className="screen-prlist mx-auto w-full max-w-3xl rounded-lg bg-background p-4 text-foreground shadow">
            {/* Global error banner for critical errors */}
            {globalError && (
                <div
                    className="mb-4 flex items-center error-message text-sm rounded px-4 py-3"
                    role="alert"
                >
                    <svg
                        className="w-5 h-5 mr-2 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path
                            fillRule="evenodd"
                            d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 112 0v4a1 1 0 01-2 0V6zm1 8a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
                            clipRule="evenodd"
                        />
                    </svg>
                    <span className="flex-1">{globalError}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setGlobalError('')}
                        className="ml-4 h-auto px-0 text-xs underline"
                        aria-label="Dismiss error message"
                    >
                        Dismiss
                    </Button>
                </div>
            )}
            <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                    Pull Requests
                </h2>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-end">
                    <a
                        href="https://buymeacoffee.com/aabiskar1"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center p-1 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Buy me a coffee"
                        title="Buy me a coffee"
                    >
                        <FaCoffee size={20} />
                    </a>
                    <ThemeSwitcher
                        theme={theme}
                        onThemeChange={handleThemeChange}
                    />
                    {/* Notifications toggle */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleToggleNotifications}
                            aria-label={
                                notificationsEnabled
                                    ? 'Disable notifications'
                                    : 'Enable notifications'
                            }
                            className="theme-toggle-switch relative inline-flex items-center h-6"
                            data-enabled={
                                notificationsEnabled ? 'true' : 'false'
                            }
                        >
                            <span className="toggle-track h-6 w-11 rounded-full transition-colors" />
                            <span
                                className={`toggle-thumb absolute left-0.5 top-0.5 w-5 h-5 rounded-full transition-transform transform ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                            />
                        </button>
                        <span className="text-sm text-muted-foreground">
                            {notificationsEnabled
                                ? '🔔 Alert on'
                                : '🔕 Alert off'}
                        </span>
                    </div>
                    <Button
                        onClick={refreshPullRequests}
                        size="sm"
                        aria-label="Refresh Pull Requests"
                    >
                        <FaSync className={isLoading ? 'animate-spin' : ''} />
                        Refresh
                    </Button>
                    <Button
                        onClick={handleSignOut}
                        variant="secondary"
                        size="sm"
                        aria-label="Sign Out"
                    >
                        <FaSignOutAlt />
                        Sign Out
                    </Button>
                </div>
            </div>
            <div className="mb-4">
                <FilterBar
                    filters={filterState}
                    onFilterChange={handleFilterChange}
                    onSortChange={handleSortChange}
                    onReset={handleResetFilters}
                    sortOption={sortOption}
                    customQueryInput={customQueryInput}
                    setCustomQueryInput={setCustomQueryInput}
                    handleSaveCustomQuery={handleSaveCustomQuery}
                    handleResetCustomQuery={handleResetCustomQuery}
                    isCustomQueryActive={isCustomQueryActive}
                    customQuery={customQuery}
                />
            </div>

            {/* Search PRs input */}
            <div className="relative mb-4 leading-none">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FaSearch className="text-muted-foreground" />
                </div>
                <Input
                    type="text"
                    placeholder="Search pull requests"
                    className="h-10 pl-10 pr-3 leading-none"
                    value={searchTerm}
                    onChange={handleSearch}
                    aria-label="Search Pull Requests"
                    name="search-pull-requests"
                    autoComplete="off"
                />
            </div>

            {filteredPRs.length === 0 ? (
                <div className="text-center py-8">
                    <p className="text-muted-foreground">
                        No pull requests found
                    </p>
                </div>
            ) : (
                <PullRequestList
                    pullRequests={filteredPRs}
                    onToggleHide={toggleHidePR}
                />
            )}
        </div>
    );
};
