import React, { useMemo, useState } from 'react';
import browser from 'webextension-polyfill';
import { FaSync, FaSignOutAlt, FaSearch, FaCoffee } from 'react-icons/fa';
import { FilterBar, type FilterState, type SortOption } from './FilterBar';
import { PullRequestList } from './PullRequestList';
import { Settings } from './Settings';
import type {
    PullRequest,
    ThemePreference,
    GroupingPreferences,
} from '../types';
import { GroupingControls } from './GroupingControls';
import { RepositoryGroupedList } from './RepositoryGroupedList';
import { groupPullRequests } from '../utils/prGrouping';
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
    groupingPreferences: GroupingPreferences;
    handleGroupingModeChange: (mode: GroupingPreferences['mode']) => void;
    handleRepositoryToggle: (key: string) => void;
    handleRepositoriesCollapsed: (keys: string[], collapsed: boolean) => void;
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
    groupingPreferences,
    handleGroupingModeChange,
    handleRepositoryToggle,
    handleRepositoriesCollapsed,
}) => {
    const groups = useMemo(
        () =>
            groupingPreferences.mode === 'repository'
                ? groupPullRequests(filteredPRs)
                : [],
        [filteredPRs, groupingPreferences.mode]
    );
    const [unavailableCollapsed, setUnavailableCollapsed] = useState<string[]>(
        []
    );
    const collapsedRepositories = useMemo(
        () =>
            new Set([
                ...groupingPreferences.collapsedRepositories,
                ...unavailableCollapsed,
            ]),
        [groupingPreferences.collapsedRepositories, unavailableCollapsed]
    );
    const setAllCollapsed = (collapsed: boolean) => {
        if (searchTerm.length > 0) return;
        handleRepositoriesCollapsed(
            groups
                .filter((group) => group.persistable)
                .map((group) => group.key),
            collapsed
        );
        const keys = groups
            .filter((group) => !group.persistable)
            .map((group) => group.key);
        setUnavailableCollapsed((previous) =>
            collapsed
                ? [...new Set([...previous, ...keys])]
                : previous.filter((key) => !keys.includes(key))
        );
    };
    const toggleRepository = (key: string) => {
        if (searchTerm.length > 0) return;
        if (key.startsWith('unavailable:'))
            setUnavailableCollapsed((previous) =>
                previous.includes(key)
                    ? previous.filter((item) => item !== key)
                    : [...previous, key]
            );
        else handleRepositoryToggle(key);
    };
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
                <div className="flex shrink-0 items-center gap-2">
                    <img
                        src={browser.runtime.getURL('branding/watchtower.png')}
                        alt=""
                        aria-hidden="true"
                        width={26}
                        height={26}
                        className="size-[26px] translate-y-px shrink-0 object-contain"
                    />
                    <h1 className="whitespace-nowrap text-xl font-bold text-foreground">
                        PR Tracker
                    </h1>
                </div>
                <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="mr-1 px-[7px]! text-muted-foreground/80 hover:text-foreground focus-visible:text-foreground"
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
                        <FaCoffee
                            size={16}
                            className="top-0! translate-y-px"
                            aria-hidden="true"
                        />
                    </Button>
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

            <GroupingControls
                mode={groupingPreferences.mode}
                onModeChange={handleGroupingModeChange}
                prCount={filteredPRs.length}
                repositoryCount={groups.length}
                searchActive={searchTerm.length > 0}
                onExpandAll={() => setAllCollapsed(false)}
                onCollapseAll={() => setAllCollapsed(true)}
            />
            {filteredPRs.length === 0 ? (
                <div className="text-center py-8">
                    <p className="text-muted-foreground">
                        No pull requests found
                    </p>
                </div>
            ) : groupingPreferences.mode === 'repository' ? (
                <RepositoryGroupedList
                    groups={groups}
                    collapsedRepositories={collapsedRepositories}
                    searchActive={searchTerm.length > 0}
                    onToggle={toggleRepository}
                    onToggleHide={toggleHidePR}
                />
            ) : (
                <PullRequestList
                    pullRequests={filteredPRs}
                    onToggleHide={toggleHidePR}
                />
            )}
        </div>
    );
};
