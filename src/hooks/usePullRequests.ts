import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import browser from 'webextension-polyfill';
import type {
    FilterState,
    SortOption,
    PullRequest,
    AppData,
    AppDataMutation,
} from '../types';
import { decryptAppData, decryptHiddenPrIds } from '../services/secureStorage';
import type { AuthState } from './useAuth';

const DEFAULT_FILTERS: FilterState = {
    showDrafts: true,
    showReady: true,
    showHidden: false,
    ageFilter: 'all',
    reviewStatus: ['approved', 'changes-requested', 'pending'],
    ciStatus: ['passing', 'failing', 'pending'],
};

const REFRESH_COMMUNICATION_ERROR = 'Unable to refresh PRs. Please try again.';
const QUERY_COMMUNICATION_ERROR =
    'Unable to update the custom query. Please try again.';

export function usePullRequests(password: string, authState: AuthState) {
    const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
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

    const persistAppDataMutation = async (mutation: AppDataMutation) => {
        const updated = await browser.runtime.sendMessage({
            type: 'UPDATE_APP_DATA',
            mutation,
        });
        if (updated !== true) {
            throw new Error('Background rejected app-data update');
        }
    };

    const loadPullRequests = useCallback(async () => {
        console.log('Loading pull requests from storage...');
        try {
            if (password && authState === 'authenticated') {
                const appData = await decryptAppData<AppData>(password);
                if (appData && appData.pullRequests) {
                    console.log('Loaded pull requests from encrypted storage');

                    // Load hidden IDs to ensuring UI matches source of truth
                    let hiddenIds: number[] = [];
                    try {
                        hiddenIds = await decryptHiddenPrIds(password);
                    } catch (e) {
                        console.error('Failed to load hidden IDs', e);
                    }
                    const hiddenSet = new Set(hiddenIds);

                    const mergedPRs = (
                        appData.pullRequests as PullRequest[]
                    ).map((pr) => ({
                        ...pr,
                        hidden: hiddenSet.has(pr.id),
                    }));

                    setPullRequests(mergedPRs);

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

    const requestPullRequestRefresh = async (
        query?: string | null
    ): Promise<void> => {
        const completed = await browser.runtime.sendMessage({
            type: 'CHECK_PRS',
            password,
            manual: true,
            ...(typeof query === 'undefined' ? {} : { customQuery: query }),
        });
        if (completed !== true) {
            throw new Error('Background refresh did not complete');
        }
        await loadPullRequests();
    };

    const runLoadingOperation = async (
        operation: () => Promise<void>,
        userMessage: string,
        logMessage: string
    ): Promise<void> => {
        setIsLoading(true);
        setGlobalError('');
        try {
            await operation();
        } catch (error) {
            console.error(logMessage, error);
            setGlobalError(userMessage);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadPullRequestsRef.current = loadPullRequests;
    }, [loadPullRequests]);

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
            void (async () => {
                try {
                    await loadPullRequests();
                } finally {
                    setIsLoading(false);
                }
            })();
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
                if (!filters.showHidden && pr.hidden) return false;

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

    const filteredPRs = useMemo(() => {
        const normalizedSearchTerm = searchTerm.toLowerCase();
        return applyFiltersAndSort(
            filterState,
            pullRequests,
            sortOption
        ).filter(
            (pr) =>
                pr.title.toLowerCase().includes(normalizedSearchTerm) ||
                pr.repository.name.toLowerCase().includes(normalizedSearchTerm)
        );
    }, [
        applyFiltersAndSort,
        filterState,
        pullRequests,
        searchTerm,
        sortOption,
    ]);

    const handleFilterChange = async (filters: FilterState) => {
        setFilterState(filters);
        if (password && authState === 'authenticated') {
            try {
                await persistAppDataMutation({
                    kind: 'set-filters',
                    filters,
                });
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
                await persistAppDataMutation({ kind: 'set-sort', sort });
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
                await persistAppDataMutation({
                    kind: 'set-filters',
                    filters: DEFAULT_FILTERS,
                });
            } catch (error) {
                console.error(
                    'Failed to update filters in encrypted storage:',
                    error
                );
            }
        }
    };

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    const handleSaveCustomQuery = async () => {
        setCustomQuery(customQueryInput);
        setIsCustomQueryActive(true);

        await runLoadingOperation(
            async () => {
                if (password && authState === 'authenticated') {
                    await persistAppDataMutation({
                        kind: 'set-custom-query',
                        customQuery: customQueryInput,
                    });
                }
                await requestPullRequestRefresh(customQueryInput);
            },
            QUERY_COMMUNICATION_ERROR,
            'Failed to update the custom query:'
        );
    };

    const handleResetCustomQuery = async () => {
        setCustomQuery('');
        setCustomQueryInput('');
        setIsCustomQueryActive(false);

        await runLoadingOperation(
            async () => {
                if (password && authState === 'authenticated') {
                    await persistAppDataMutation({
                        kind: 'set-custom-query',
                        customQuery: null,
                    });
                }
                await requestPullRequestRefresh(null);
            },
            QUERY_COMMUNICATION_ERROR,
            'Failed to reset the custom query:'
        );
    };

    const handleToggleNotifications = async () => {
        const newValue = !notificationsEnabled;
        setNotificationsEnabled(newValue);

        if (password && authState === 'authenticated') {
            try {
                await persistAppDataMutation({
                    kind: 'set-notifications-enabled',
                    enabled: newValue,
                });
            } catch (error) {
                console.error(
                    'Failed to update notifications setting in encrypted storage:',
                    error
                );
            }
        }
    };

    const toggleHidePR = async (id: number) => {
        // Optimistic update locally
        const updatedPRs = pullRequests.map((pr) =>
            pr.id === id ? { ...pr, hidden: !pr.hidden } : pr
        );
        setPullRequests(updatedPRs);

        if (password && authState === 'authenticated') {
            try {
                const hidden =
                    updatedPRs.find((pr) => pr.id === id)?.hidden === true;
                await persistAppDataMutation({
                    kind: 'set-hidden',
                    id,
                    hidden,
                });
            } catch (error) {
                console.error(
                    'Failed to update hidden status in storage:',
                    error
                );
            }
        }
    };

    const refreshPullRequests = async () => {
        await runLoadingOperation(
            () => requestPullRequestRefresh(),
            REFRESH_COMMUNICATION_ERROR,
            'Failed to request a pull-request refresh:'
        );
    };

    return {
        pullRequests,
        filteredPRs,
        searchTerm,
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
        toggleHidePR,
    };
}
