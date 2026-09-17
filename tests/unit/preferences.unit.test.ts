import browser from 'webextension-polyfill';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { usePullRequests } from '../../src/hooks/usePullRequests';
import {
    decryptAppData,
    decryptHiddenPrIds,
} from '../../src/services/secureStorage';
import type { AppData, FilterState, PullRequest } from '../../src/types';

const hookHarness = vi.hoisted(() => ({
    stateIndex: 0,
    values: [] as unknown[],
    setters: [] as Mock[],
    effects: [] as Array<() => unknown>,
}));

vi.mock('react', () => ({
    useState: vi.fn((initialValue: unknown) => {
        const index = hookHarness.stateIndex;
        hookHarness.stateIndex += 1;
        const setter = vi.fn();
        hookHarness.setters[index] = setter;
        const value =
            index in hookHarness.values
                ? hookHarness.values[index]
                : initialValue;
        return [value, setter];
    }),
    useEffect: vi.fn((effect: () => unknown) => {
        hookHarness.effects.push(effect);
    }),
    useRef: vi.fn((initialValue: unknown) => ({ current: initialValue })),
    useCallback: vi.fn((callback: unknown) => callback),
    useMemo: vi.fn((factory: () => unknown) => factory()),
}));

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
            onMessage: {
                addListener: vi.fn(),
                removeListener: vi.fn(),
            },
        },
        storage: {
            onChanged: {
                addListener: vi.fn(),
                removeListener: vi.fn(),
            },
        },
    },
}));

vi.mock('../../src/services/secureStorage', () => ({
    decryptAppData: vi.fn(),
    decryptHiddenPrIds: vi.fn(),
}));

const PASSWORD = 'password123';

const DEFAULT_FILTERS: FilterState = {
    showDrafts: true,
    showReady: true,
    showHidden: false,
    ageFilter: 'all',
    reviewStatus: ['approved', 'changes-requested', 'pending'],
    ciStatus: ['passing', 'failing', 'pending'],
};

const SAVED_FILTERS: FilterState = {
    showDrafts: false,
    showReady: true,
    showHidden: true,
    ageFilter: 'week',
    reviewStatus: ['changes-requested'],
    ciStatus: ['failing', 'pending'],
};

const pullRequest = (id: number): PullRequest => ({
    id,
    title: `PR ${id}`,
    html_url: `https://github.com/acme/repo/pull/${id}`,
    repository: { name: 'repo' },
    state: 'open',
    draft: false,
    created_at: '2026-01-02T03:04:05.000Z',
    requested_reviewers: [],
});

const appData = (preferences: AppData['preferences'] = {}): AppData => ({
    pullRequests: [pullRequest(1), pullRequest(2)],
    oldPullRequests: [pullRequest(1), pullRequest(2)],
    lastUpdated: '2026-01-02T03:04:05.000Z',
    preferences,
});

const PreferencesHookHarness = () => usePullRequests(PASSWORD, 'authenticated');

const renderPreferences = (stateValues: Record<number, unknown> = {}) => {
    hookHarness.stateIndex = 0;
    hookHarness.values = [];
    for (const [index, value] of Object.entries(stateValues)) {
        hookHarness.values[Number(index)] = value;
    }
    return PreferencesHookHarness();
};

describe('usePullRequests preference persistence', () => {
    beforeEach(() => {
        hookHarness.stateIndex = 0;
        hookHarness.values = [];
        hookHarness.setters = [];
        hookHarness.effects = [];
        vi.clearAllMocks();
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue(true);
        vi.mocked(decryptAppData).mockResolvedValue(appData());
        vi.mocked(decryptHiddenPrIds).mockResolvedValue([]);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('uses current defaults when no saved preference has been loaded', () => {
        const preferences = renderPreferences();

        expect(preferences.searchTerm).toBe('');
        expect(preferences.filterState).toEqual(DEFAULT_FILTERS);
        expect(preferences.sortOption).toBe('newest');
        expect(preferences.customQuery).toBe('');
        expect(preferences.customQueryInput).toBe('');
        expect(preferences.isCustomQueryActive).toBe(false);
        expect(preferences.notificationsEnabled).toBe(true);
    });

    it('derives case-insensitive title and repository search results from search state', () => {
        const prs = [
            {
                ...pullRequest(1),
                title: 'Add authentication flow',
                repository: { name: 'identity-service' },
            },
            {
                ...pullRequest(2),
                title: 'Update dashboard',
                repository: { name: 'web-app' },
            },
        ];
        const preferences = renderPreferences({ 0: prs, 1: 'AUTHENTICATION' });

        expect(preferences.filteredPRs).toEqual([prs[0]]);

        preferences.handleSearch({
            target: { value: 'WEB-APP' },
        } as React.ChangeEvent<HTMLInputElement>);
        expect(hookHarness.setters[1]).toHaveBeenCalledWith('WEB-APP');
    });

    it('restores saved notification, filter, sort, custom-query, and hidden-ID state', async () => {
        vi.mocked(decryptAppData).mockResolvedValue(
            appData({
                notificationsEnabled: false,
                customQuery: 'is:pr org:acme label:urgent',
                filters: SAVED_FILTERS,
                sort: 'oldest',
            })
        );
        vi.mocked(decryptHiddenPrIds).mockResolvedValue([2]);
        renderPreferences();

        hookHarness.effects[3]();

        await vi.waitFor(() => {
            expect(hookHarness.setters[0]).toHaveBeenCalledWith([
                { ...pullRequest(1), hidden: false },
                { ...pullRequest(2), hidden: true },
            ]);
            expect(hookHarness.setters[3]).toHaveBeenCalledWith(SAVED_FILTERS);
            expect(hookHarness.setters[4]).toHaveBeenCalledWith('oldest');
            expect(hookHarness.setters[5]).toHaveBeenCalledWith(
                'is:pr org:acme label:urgent'
            );
            expect(hookHarness.setters[6]).toHaveBeenCalledWith(
                'is:pr org:acme label:urgent'
            );
            expect(hookHarness.setters[7]).toHaveBeenCalledWith(true);
            expect(hookHarness.setters[8]).toHaveBeenCalledWith(false);
            expect(hookHarness.setters[2]).toHaveBeenCalledWith(false);
        });
    });

    it('persists a filter update without losing other application data', async () => {
        const stored = appData({ notificationsEnabled: false, sort: 'newest' });
        vi.mocked(decryptAppData).mockResolvedValue(stored);
        const preferences = renderPreferences();

        await preferences.handleFilterChange(SAVED_FILTERS);

        expect(hookHarness.setters[3]).toHaveBeenCalledWith(SAVED_FILTERS);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'UPDATE_APP_DATA',
            mutation: { kind: 'set-filters', filters: SAVED_FILTERS },
        });
    });

    it('persists a sort update and preserves existing preferences', async () => {
        const stored = appData({ filters: SAVED_FILTERS });
        vi.mocked(decryptAppData).mockResolvedValue(stored);
        const preferences = renderPreferences();

        await preferences.handleSortChange('most-stale');

        expect(hookHarness.setters[4]).toHaveBeenCalledWith('most-stale');
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'UPDATE_APP_DATA',
            mutation: { kind: 'set-sort', sort: 'most-stale' },
        });
    });

    it('resets and persists filters to the current defaults', async () => {
        const stored = appData({ filters: SAVED_FILTERS });
        vi.mocked(decryptAppData).mockResolvedValue(stored);
        const preferences = renderPreferences();

        await preferences.handleResetFilters();

        expect(hookHarness.setters[3]).toHaveBeenCalledWith(DEFAULT_FILTERS);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'UPDATE_APP_DATA',
            mutation: { kind: 'set-filters', filters: DEFAULT_FILTERS },
        });
    });

    it('saves a custom query to encrypted preferences and requests a matching refresh', async () => {
        vi.useFakeTimers();
        const stored = appData({ notificationsEnabled: true });
        vi.mocked(decryptAppData).mockResolvedValue(stored);
        const query = 'is:pr org:acme review-requested:octo-user';
        const preferences = renderPreferences({ 6: query });

        await preferences.handleSaveCustomQuery();

        expect(hookHarness.setters[5]).toHaveBeenCalledWith(query);
        expect(hookHarness.setters[7]).toHaveBeenCalledWith(true);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'UPDATE_APP_DATA',
            mutation: { kind: 'set-custom-query', customQuery: query },
        });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'CHECK_PRS',
            password: PASSWORD,
            manual: true,
            customQuery: query,
        });
    });

    it('removes a custom query from encrypted preferences and requests the default searches', async () => {
        vi.useFakeTimers();
        const stored = appData({
            customQuery: 'is:pr org:acme',
            notificationsEnabled: false,
        });
        vi.mocked(decryptAppData).mockResolvedValue(stored);
        const preferences = renderPreferences({
            5: 'is:pr org:acme',
            6: 'is:pr org:acme',
            7: true,
        });

        await preferences.handleResetCustomQuery();

        expect(hookHarness.setters[5]).toHaveBeenCalledWith('');
        expect(hookHarness.setters[6]).toHaveBeenCalledWith('');
        expect(hookHarness.setters[7]).toHaveBeenCalledWith(false);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'UPDATE_APP_DATA',
            mutation: { kind: 'set-custom-query', customQuery: null },
        });
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'CHECK_PRS',
            password: PASSWORD,
            manual: true,
            customQuery: null,
        });
    });

    it.each([
        { current: true, expected: false },
        { current: false, expected: true },
    ])(
        'toggles notification preference from $current to $expected and persists it',
        async ({ current, expected }) => {
            const stored = appData({ notificationsEnabled: current });
            vi.mocked(decryptAppData).mockResolvedValue(stored);
            const preferences = renderPreferences({ 8: current });

            await preferences.handleToggleNotifications();

            expect(hookHarness.setters[8]).toHaveBeenCalledWith(expected);
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'UPDATE_APP_DATA',
                mutation: {
                    kind: 'set-notifications-enabled',
                    enabled: expected,
                },
            });
        }
    );

    it('delegates notification persistence without reading app data in the popup', async () => {
        const preferences = renderPreferences({ 8: true });

        await preferences.handleToggleNotifications();

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'UPDATE_APP_DATA',
            mutation: {
                kind: 'set-notifications-enabled',
                enabled: false,
            },
        });
    });

    it('delegates hidden-ID and snapshot persistence to the background', async () => {
        const stored = appData();
        const preferences = renderPreferences({
            0: stored.pullRequests,
        });

        await preferences.toggleHidePR(1);

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'UPDATE_APP_DATA',
            mutation: { kind: 'set-hidden', id: 1, hidden: true },
        });
    });
});
