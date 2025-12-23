import { useState, useEffect, useRef, useCallback } from 'react';
import browser from 'webextension-polyfill';
import { FilterState, SortOption, PullRequest, AppData } from '../types';
import { decryptAppData, encryptAppData } from '../services/secureStorage';
import { AuthState } from './useAuth';

const DEFAULT_FILTERS: FilterState = {
    showDrafts: true,
    showReady: true,
    ageFilter: 'all',
    reviewStatus: ['approved', 'changes-requested', 'pending'],
    ciStatus: ['passing', 'failing', 'pending'],
};

export function usePullRequests(password: string, authState: AuthState) {
    const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
    const [filteredPRs, setFilteredPRs] = useState<PullRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterState, setFilterState] =
        useState<FilterState>(DEFAULT_FILTERS);
    const [sortOption, setSortOption] = useState<SortOption>('newest');
    const [customQuery, setCustomQuery] = useState<string>('');
    const [customQueryInput, setCustomQueryInput] = useState<string>('');
    const [isCustomQueryActive, setIsCustomQueryActive] =
        useState<boolean>(false);
    const [notificationsEnabled, setNotificationsEnabled] =
        useState<boolean>(true);
    const [globalError, setGlobalError] = useState<string>('');

    const loadPullRequestsRef = useRef<(() => Promise<void>) | null>(null);

    const loadPullRequests = useCallback(async () => {
        console.log('Loading pull requests from storage...');
        try {
            if (password && authState === 'authenticated') {
                const appData = await decryptAppData<AppData>(password);
                if (appData && appData.pullRequests) {
                    console.log('Loaded pull requests from encrypted storage');
                    setPullRequests(appData.pullRequests as PullRequest[]);

                    // Load preferences
                    if (appData.preferences) {
                        if (
                            typeof appData.preferences.notificationsEnabled ===
                            'boolean'
                        ) {
                            setNotificationsEnabled(
                                appData.preferences.notificationsEnabled
                            );
                        }
                        if (appData.preferences.customQuery) {
                            setCustomQuery(appData.preferences.customQuery);
                            setCustomQueryInput(
                                appData.preferences.customQuery
                            );
                            setIsCustomQueryActive(true);
                        }
                        if (appData.preferences.filters) {
                            setFilterState(appData.preferences.filters);
                        }
                        if (appData.preferences.sort) {
                            setSortOption(appData.preferences.sort);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error loading pull requests:', error);
        }
    }, [password, authState]);

    loadPullRequestsRef.current = loadPullRequests;

    // Listen for messages from background script
    useEffect(() => {
        function handleMessage(message: unknown) {
            if (!message || typeof message !== 'object') return;
            const typedMessage = message as Record<string, unknown>;

            if (
                typedMessage.type === 'SHOW_ERROR' &&
                typeof typedMessage.message === 'string'
            ) {
                setGlobalError(typedMessage.message);
            } else if (typedMessage.type === 'DATA_UPDATED') {
                console.log('Received DATA_UPDATED message, refreshing UI...');
                if (loadPullRequestsRef.current) {
                    loadPullRequestsRef.current();
                }
                if (loadPullRequestsRef.current) {
                    loadPullRequestsRef.current();
                }
            } else if (typedMessage.type === 'AUTH_STATE_CHANGED') {
                console.log(
                    'Received AUTH_STATE_CHANGED message, checking auth state...'
                );
                setTimeout(() => {
                    if (loadPullRequestsRef.current) {
                        loadPullRequestsRef.current();
                    }
                }, 100);
            }
        }
        if (browser.runtime && browser.runtime.onMessage) {
            browser.runtime.onMessage.addListener(handleMessage);
            return () => {
                browser.runtime.onMessage.removeListener(handleMessage);
            };
        }
    }, []);

    // Storage listener
    useEffect(() => {
        const storageListener = (
            changes: Record<string, browser.Storage.StorageChange>
        ) => {
            if (
                changes.encryptedAppData &&
                password &&
                authState === 'authenticated'
            ) {
                console.log('Encrypted app data changed, reloading...');
                loadPullRequests();
            }
        };

        if (browser.storage?.onChanged?.addListener) {
            browser.storage.onChanged.addListener(storageListener);
        }

        return () => {
            if (browser.storage?.onChanged?.removeListener) {
                browser.storage.onChanged.removeListener(storageListener);
            }
        };
    }, [password, authState, loadPullRequests]);

    // Initial load
    useEffect(() => {
        if (authState === 'authenticated') {
            loadPullRequests().then(() => setIsLoading(false));
        } else {
            setIsLoading(false);
        }
    }, [authState, loadPullRequests]);

    // Request fresh data when popup opens
    useEffect(() => {
        if (authState === 'authenticated' && password) {
            console.log('Popup authenticated, requesting fresh data...');
            browser.runtime
                .sendMessage({
                    type: 'POPUP_OPENED',
                    timestamp: Date.now(),
                })
                .catch(() => {
                    console.log('Could not send POPUP_OPENED message');
                });
        }
    }, [authState, password]);

    const applyFiltersAndSort = useCallback(
        (filters: FilterState, prs: PullRequest[], sort: SortOption) => {
            let filtered = prs.filter((pr) => {
                if (pr.draft && !filters.showDrafts) return false;
                if (!pr.draft && !filters.showReady) return false;
                if (filters.ageFilter !== 'all') {
                    const days =
                        (Date.now() - new Date(pr.created_at).getTime()) /
                        (1000 * 60 * 60 * 24);
                    if (filters.ageFilter === 'today' && days > 1) return false;
                    if (filters.ageFilter === 'week' && days > 7) return false;
                    if (filters.ageFilter === 'older' && days <= 7)
                        return false;
                }
                if (
                    filters.reviewStatus.length > 0 &&
                    pr.review_status &&
                    !filters.reviewStatus.includes(pr.review_status)
                )
                    return false;
                if (
                    filters.ciStatus.length > 0 &&
                    pr.ci_status &&
                    !filters.ciStatus.includes(pr.ci_status)
                )
                    return false;
                return true;
            });

            filtered = [...filtered].sort((a, b) => {
                switch (sort) {
                    case 'newest':
                        return (
                            new Date(b.created_at).getTime() -
                            new Date(a.created_at).getTime()
                        );
                    case 'oldest':
                        return (
                            new Date(a.created_at).getTime() -
                            new Date(b.created_at).getTime()
                        );
                    case 'urgent':
                        return (
                            b.requested_reviewers.length -
                            a.requested_reviewers.length
                        );
                    case 'most-stale': {
                        const aReviewed = a.review_status === 'approved';
                        const bReviewed = b.review_status === 'approved';
                        if (aReviewed !== bReviewed) return aReviewed ? 1 : -1;
                        return (
                            new Date(a.created_at).getTime() -
                            new Date(b.created_at).getTime()
                        );
                    }
                    default:
                        return 0;
                }
            });
            return filtered;
        },
        []
    );

    useEffect(() => {
        setFilteredPRs(
            applyFiltersAndSort(filterState, pullRequests, sortOption)
        );
    }, [pullRequests, filterState, sortOption, applyFiltersAndSort]);

    const handleFilterChange = async (filters: FilterState) => {
        setFilterState(filters);
        if (password && authState === 'authenticated') {
            try {
                const appData = await decryptAppData<AppData>(password);
                if (appData) {
                    appData.preferences = appData.preferences || {};
                    appData.preferences.filters = filters;
                    await encryptAppData(appData, password);
                }
            } catch (error) {
                console.error(
                    'Failed to update filters in encrypted storage:',
                    error
                );
            }
        }
    };

    const handleSortChange = async (sort: SortOption) => {
        setSortOption(sort);
        if (password && authState === 'authenticated') {
            try {
                const appData = await decryptAppData<AppData>(password);
                if (appData) {
                    appData.preferences = appData.preferences || {};
                    appData.preferences.sort = sort;
                    await encryptAppData(appData, password);
                }
            } catch (error) {
                console.error(
                    'Failed to update sort in encrypted storage:',
                    error
                );
            }
        }
    };

    const handleResetFilters = async () => {
        setFilterState(DEFAULT_FILTERS);
        if (password && authState === 'authenticated') {
            try {
                const appData = await decryptAppData<AppData>(password);
                if (appData) {
                    appData.preferences = appData.preferences || {};
                    appData.preferences.filters = DEFAULT_FILTERS;
                    await encryptAppData(appData, password);
                }
            } catch (error) {
                console.error(
                    'Failed to update filters in encrypted storage:',
                    error
                );
            }
        }
    };

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        const searchTerm = e.target.value.toLowerCase();
        const filtered = applyFiltersAndSort(
            filterState,
            pullRequests,
            sortOption
        ).filter(
            (pr) =>
                pr.title.toLowerCase().includes(searchTerm) ||
                pr.repository.name.toLowerCase().includes(searchTerm)
        );
        setFilteredPRs(filtered);
    };

    const handleSaveCustomQuery = async () => {
        setCustomQuery(customQueryInput);
        setIsCustomQueryActive(true);

        if (password && authState === 'authenticated') {
            try {
                const appData = await decryptAppData<AppData>(password);
                if (appData) {
                    appData.preferences = appData.preferences || {};
                    appData.preferences.customQuery = customQueryInput;
                    await encryptAppData(appData, password);
                }
            } catch (error) {
                console.error(
                    'Failed to update custom query in encrypted storage:',
                    error
                );
            }
        }

        setIsLoading(true);
        await browser.runtime.sendMessage({
            type: 'CHECK_PRS',
            password,
            manual: true,
            customQuery: customQueryInput,
        });
        setTimeout(async () => {
            await loadPullRequests();
            setIsLoading(false);
        }, 1500);
    };

    const handleResetCustomQuery = async () => {
        setCustomQuery('');
        setCustomQueryInput('');
        setIsCustomQueryActive(false);

        if (password && authState === 'authenticated') {
            try {
                const appData = await decryptAppData<AppData>(password);
                if (appData) {
                    appData.preferences = appData.preferences || {};
                    delete appData.preferences.customQuery;
                    await encryptAppData(appData, password);
                }
            } catch (error) {
                console.error(
                    'Failed to clear custom query in encrypted storage:',
                    error
                );
            }
        }

        setIsLoading(true);
        await browser.runtime.sendMessage({
            type: 'CHECK_PRS',
            password,
            manual: true,
            customQuery: null,
        });
        setTimeout(async () => {
            await loadPullRequests();
            setIsLoading(false);
        }, 1500);
    };

    const handleToggleNotifications = async () => {
        const newValue = !notificationsEnabled;
        setNotificationsEnabled(newValue);

        if (password && authState === 'authenticated') {
            try {
                const appData = await decryptAppData<AppData>(password);
                if (appData) {
                    appData.preferences = appData.preferences || {};
                    appData.preferences.notificationsEnabled = newValue;
                    await encryptAppData(appData, password);
                } else {
                    await encryptAppData(
                        {
                            pullRequests: [],
                            lastUpdated: new Date().toISOString(),
                            preferences: { notificationsEnabled: newValue },
                            oldPullRequests: [],
                        },
                        password
                    );
                }
            } catch (error) {
                console.error(
                    'Failed to update notifications setting in encrypted storage:',
                    error
                );
            }
        }
    };

    const refreshPullRequests = async () => {
        setIsLoading(true);
        await browser.runtime.sendMessage({
            type: 'CHECK_PRS',
            password,
            manual: true,
        });
        setTimeout(async () => {
            await loadPullRequests();
            setIsLoading(false);
        }, 1500);
    };

    return {
        pullRequests,
        filteredPRs,
        isLoading,
        filterState,
        sortOption,
        customQuery,
        customQueryInput,
        setCustomQueryInput,
        isCustomQueryActive,
        notificationsEnabled,
        globalError,
        setGlobalError,
        handleFilterChange,
        handleSortChange,
        handleResetFilters,
        handleSearch,
        handleSaveCustomQuery,
        handleResetCustomQuery,
        handleToggleNotifications,
        refreshPullRequests,
    };
}
