import React from 'react';
import browser from 'webextension-polyfill';
import { FaSync, FaSignOutAlt, FaSearch, FaCoffee } from 'react-icons/fa';
import { FilterBar, type FilterState, type SortOption } from './FilterBar';
import { PullRequestList } from './PullRequestList';
import { Settings } from './Settings';
import type { PullRequest, ThemePreference } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { LastChecked } from './LastChecked';

interface DashboardProps {
    globalError: string;
    setGlobalError: (error: string) => void;
    theme: ThemePreference;
    handleThemeChange: (theme: ThemePreference) => void;
    notificationsEnabled: boolean;
    handleToggleNotifications: () => void;
    isLoading: boolean;
    refreshPullRequests: () => void;
    lastSuccessfulRefreshAt?: string;
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
    lastSuccessfulRefreshAt,
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
            <header className="popup-header mb-4 flex flex-nowrap items-center justify-between gap-3">
                <div className="flex shrink-0 items-center gap-1">
                    <h2 className="whitespace-nowrap text-xl font-bold text-foreground">
                        Pull Requests
                    </h2>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Open Buy Me a Coffee page"
                        title="Buy me a coffee"
                        onClick={() => {
                            void browser.tabs
                                .create({
                                    url: 'https://buymeacoffee.com/aabiskar1',
                                    active: true,
                                })
                                .catch((error) => {
                                    console.error(
                                        'Could not open support page:',
                                        error
                                    );
                                    setGlobalError(
                                        'Unable to open the support page. Please try again.'
                                    );
                                });
                        }}
                    >
                        <FaCoffee size={14} aria-hidden="true" />
                    </Button>
                </div>
                <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
                    <LastChecked
                        lastSuccessfulRefreshAt={lastSuccessfulRefreshAt}
                    />
                    <Button
                        onClick={refreshPullRequests}
                        size="sm"
                        aria-label="Refresh Pull Requests"
                    >
                        <FaSync
                            aria-hidden="true"
                            className={isLoading ? 'animate-spin' : ''}
                        />
                        Refresh
                    </Button>
                    <Settings
                        theme={theme}
                        onThemeChange={handleThemeChange}
                        notificationsEnabled={notificationsEnabled}
                        onToggleNotifications={handleToggleNotifications}
                    />
                    <Button
                        onClick={handleSignOut}
                        variant="secondary"
                        size="sm"
                        aria-label="Sign Out"
                    >
                        <FaSignOutAlt aria-hidden="true" />
                        Sign Out
                    </Button>
                </div>
            </header>
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
                    className="popup-search-input h-10 pl-10 pr-3 leading-none"
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
