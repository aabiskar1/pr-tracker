import React from 'react';
import { FaSync, FaSignOutAlt, FaSearch } from 'react-icons/fa';
import { FilterBar, FilterState, SortOption } from './FilterBar';
import { PullRequestList } from './PullRequestList';
import ThemeSwitcher from './ThemeSwitcher';
import { PullRequest, ThemePreference } from '../types';

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
    handleSearch: (e: React.ChangeEvent<HTMLInputElement>) => void;
    filteredPRs: PullRequest[];
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
    handleSearch,
    filteredPRs,
}) => {
    return (
        <div className="screen-prlist w-full max-w-3xl mx-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
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
                    <button
                        onClick={() => setGlobalError('')}
                        className="ml-4 text-xs underline text-gray-700 dark:text-gray-200"
                        aria-label="Dismiss error message"
                    >
                        Dismiss
                    </button>
                </div>
            )}
            <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-800 dark:text-white">
                    Pull Requests
                </h2>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-end">
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
                            data-enabled={notificationsEnabled ? 'true' : 'false'}
                        >
                            <span
                                className={`toggle-track w-11 h-6 rounded-full transition-colors ${notificationsEnabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                            />
                            <span
                                className={`toggle-thumb absolute left-0.5 top-0.5 w-5 h-5 rounded-full transition-transform transform ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                            />
                        </button>
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                            {notificationsEnabled
                                ? '🔔 Alert on'
                                : '🔕 Alert off'}
                        </span>
                    </div>
                    <button
                        onClick={refreshPullRequests}
                        className="bg-primary text-white px-3 py-1 rounded-md hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                        aria-label="Refresh Pull Requests"
                    >
                        <FaSync className={isLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                    <button
                        onClick={handleSignOut}
                        className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors inline-flex items-center gap-2"
                        aria-label="Sign Out"
                    >
                        <FaSignOutAlt />
                        Sign Out
                    </button>
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
                    <FaSearch className="text-gray-400" />
                </div>
                <input
                    type="text"
                    placeholder="Search pull requests"
                    className="w-full pl-10 pr-3 h-10 leading-none border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    onChange={handleSearch}
                    aria-label="Search Pull Requests"
                    name="search-pull-requests"
                    autoComplete="off"
                />
            </div>

            {filteredPRs.length === 0 ? (
                <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">
                        No pull requests found
                    </p>
                </div>
            ) : (
                <PullRequestList pullRequests={filteredPRs} />
            )}
        </div>
    );
};
