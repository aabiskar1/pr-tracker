import browser from 'webextension-polyfill';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    checkPullRequests,
    resetPullRequestManagerStateForTests,
} from '../../src/background/prManager';
import { constants, state } from '../../src/background/state';
import { fetchPullRequests, handleApiError } from '../../src/background/api';
import {
    clearGitHubRateLimitCooldown,
    formatGitHubCooldownTime,
    getActiveGitHubRateLimitCooldown,
    persistGitHubRateLimitCooldown,
    type GitHubRateLimitCooldown,
} from '../../src/background/githubRateLimit';
import {
    createNotification,
    setBadgeText,
} from '../../src/background/notifications';
import {
    decryptAppData,
    decryptHiddenPrIds,
    decryptToken,
    encryptAppData,
} from '../../src/services/secureStorage';
import type { AppData, PullRequest } from '../../src/types';

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(async () => undefined),
        },
        storage: {
            session: {
                get: vi.fn(async () => ({})),
            },
            local: {
                get: vi.fn(async () => ({})),
            },
        },
    },
}));

vi.mock('../../src/services/secureStorage', () => ({
    decryptToken: vi.fn(),
    decryptAppData: vi.fn(),
    encryptAppData: vi.fn(),
    decryptHiddenPrIds: vi.fn(),
}));

vi.mock('../../src/background/api', () => ({
    fetchPullRequests: vi.fn(),
    handleApiError: vi.fn(async () => ({
        message: 'Request failed',
        isRateLimit: false,
        isAuth: false,
    })),
}));

vi.mock('../../src/background/githubRateLimit', () => ({
    clearGitHubRateLimitCooldown: vi.fn(async () => undefined),
    formatGitHubCooldownTime: vi.fn(() => '09:10'),
    getActiveGitHubRateLimitCooldown: vi.fn(async () => null),
    persistGitHubRateLimitCooldown: vi.fn(async () => undefined),
}));

vi.mock('../../src/background/notifications', () => ({
    createNotification: vi.fn(async () => undefined),
    setBadgeText: vi.fn(async () => undefined),
}));

const PASSWORD = 'active-password';
const TOKEN = 'sanitized-token';
const FIXED_TIME = new Date('2030-06-07T08:09:10.000Z');
const COOLDOWN: GitHubRateLimitCooldown = {
    classification: 'primary',
    nextAllowedAt: FIXED_TIME.getTime() + 60_000,
    deadlineSource: 'reset',
    resource: 'core',
};

const pullRequest = (id: number): PullRequest => ({
    id,
    title: `PR ${id}`,
    html_url: `https://github.com/acme/repo/pull/${id}`,
    repository: { name: 'repo' },
    state: 'open',
    draft: false,
    created_at: '2030-06-01T00:00:00.000Z',
    requested_reviewers: [],
});

const appData = (overrides: Partial<AppData> = {}): AppData => ({
    pullRequests: [],
    oldPullRequests: [],
    lastUpdated: '2030-06-01T00:00:00.000Z',
    preferences: { notificationsEnabled: true },
    ...overrides,
});

const clone = <T>(value: T): T => structuredClone(value);
const successfulFetch = (
    pullRequests: PullRequest[],
    rateLimit?: GitHubRateLimitCooldown
) => ({
    status: 'success' as const,
    pullRequests,
    ...(rateLimit ? { rateLimit } : {}),
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

describe('background PR polling and notification decisions', () => {
    let storedData: AppData;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_TIME);
        delete (globalThis as { _prTrackerLastManual?: number })
            ._prTrackerLastManual;
        state.sessionPassword = PASSWORD;
        state.rememberPassword = false;
        state.lastRefreshTime = 0;
        state.isCheckingPRs = false;
        state.lastNewPRNotificationTime = 0;
        storedData = appData();
        vi.mocked(decryptToken).mockResolvedValue(TOKEN);
        vi.mocked(decryptAppData).mockImplementation(async () =>
            clone(storedData)
        );
        vi.mocked(encryptAppData).mockImplementation(async (data) => {
            storedData = clone(data as AppData);
        });
        vi.mocked(decryptHiddenPrIds).mockResolvedValue([]);
        vi.mocked(fetchPullRequests).mockResolvedValue(successfulFetch([]));
        vi.mocked(getActiveGitHubRateLimitCooldown).mockResolvedValue(null);
        vi.mocked(browser.storage.session.get).mockResolvedValue({});
        vi.mocked(browser.storage.local.get).mockResolvedValue({});
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue(undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ login: 'octo-user' }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
            )
        );
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('fetches, badges, persists, publishes an update, and advances the comparison snapshot', async () => {
        const prs = [pullRequest(1), pullRequest(2)];
        storedData = appData({
            oldPullRequests: [pullRequest(1)],
            preferences: {
                notificationsEnabled: true,
                customQuery: 'is:pr org:acme',
            },
        });
        vi.mocked(fetchPullRequests).mockResolvedValue(successfulFetch(prs));

        await checkPullRequests(true);

        expect(fetch).toHaveBeenCalledWith('https://api.github.com/user', {
            headers: {
                Authorization: `token ${TOKEN}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        expect(fetchPullRequests).toHaveBeenCalledWith(
            TOKEN,
            { login: 'octo-user' },
            'is:pr org:acme',
            createNotification
        );
        expect(setBadgeText).toHaveBeenCalledWith('2');
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'DATA_UPDATED',
            timestamp: FIXED_TIME.getTime(),
        });
        expect(storedData).toEqual({
            pullRequests: prs,
            oldPullRequests: prs,
            lastUpdated: FIXED_TIME.toISOString(),
            preferences: {
                notificationsEnabled: true,
                customQuery: 'is:pr org:acme',
            },
        });
        expect(encryptAppData).toHaveBeenCalledTimes(2);
        expect(clearGitHubRateLimitCooldown).toHaveBeenCalledOnce();
        expect(state.isCheckingPRs).toBe(false);
    });

    it('silently suppresses an automatic refresh during an active cooldown', async () => {
        const originalData = clone(storedData);
        vi.mocked(getActiveGitHubRateLimitCooldown).mockResolvedValue(COOLDOWN);

        await checkPullRequests(false);

        expect(fetch).not.toHaveBeenCalled();
        expect(fetchPullRequests).not.toHaveBeenCalled();
        expect(setBadgeText).not.toHaveBeenCalled();
        expect(encryptAppData).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
        expect(createNotification).not.toHaveBeenCalled();
        expect(storedData).toEqual(originalData);
    });

    it('explains an active cooldown without making a manual refresh request', async () => {
        const originalData = clone(storedData);
        vi.mocked(getActiveGitHubRateLimitCooldown).mockResolvedValue(COOLDOWN);

        await checkPullRequests(true);

        expect(fetch).not.toHaveBeenCalled();
        expect(fetchPullRequests).not.toHaveBeenCalled();
        expect(setBadgeText).not.toHaveBeenCalled();
        expect(encryptAppData).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).toHaveBeenCalledOnce();
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message:
                'GitHub rate limited until 09:10. Showing cached pull requests.',
        });
        expect(formatGitHubCooldownTime).toHaveBeenCalledWith(
            COOLDOWN.nextAllowedAt
        );
        expect(storedData).toEqual(originalData);
    });

    it('allows an expired cooldown to proceed and clears it after recovery', async () => {
        vi.mocked(getActiveGitHubRateLimitCooldown).mockResolvedValue(null);

        await checkPullRequests(true);

        expect(fetch).toHaveBeenCalledOnce();
        expect(fetchPullRequests).toHaveBeenCalledOnce();
        expect(clearGitHubRateLimitCooldown).toHaveBeenCalledOnce();
    });

    it('preserves cached success state when the top-level search fails', async () => {
        const cachedPrs = [pullRequest(1), pullRequest(2)];
        const previousPrs = [pullRequest(1)];
        storedData = appData({
            pullRequests: cachedPrs,
            oldPullRequests: previousPrs,
        });
        const originalData = clone(storedData);
        vi.mocked(fetchPullRequests).mockResolvedValue({ status: 'failure' });

        await checkPullRequests(true);

        expect(storedData).toEqual(originalData);
        expect(setBadgeText).not.toHaveBeenCalled();
        expect(encryptAppData).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DATA_UPDATED' })
        );
        expect(createNotification).not.toHaveBeenCalled();
        expect(state.lastNewPRNotificationTime).toBe(0);
        expect(state.isCheckingPRs).toBe(false);
    });

    it('persists a new cooldown when a post-expiry search is rate limited', async () => {
        vi.mocked(fetchPullRequests).mockResolvedValue({
            status: 'failure',
            rateLimit: COOLDOWN,
        });

        await checkPullRequests(true);

        expect(persistGitHubRateLimitCooldown).toHaveBeenCalledWith(COOLDOWN);
        expect(clearGitHubRateLimitCooldown).not.toHaveBeenCalled();
        expect(setBadgeText).not.toHaveBeenCalled();
        expect(encryptAppData).not.toHaveBeenCalled();
    });

    it('persists an optional cooldown while completing the successful refresh', async () => {
        const prs = [pullRequest(1), pullRequest(2)];
        storedData = appData({ oldPullRequests: [pullRequest(1)] });
        vi.mocked(fetchPullRequests).mockResolvedValue(
            successfulFetch(prs, COOLDOWN)
        );

        await checkPullRequests(true);

        expect(persistGitHubRateLimitCooldown).toHaveBeenCalledWith(COOLDOWN);
        expect(clearGitHubRateLimitCooldown).not.toHaveBeenCalled();
        expect(setBadgeText).toHaveBeenCalledWith('2');
        expect(storedData.pullRequests).toEqual(prs);
        expect(storedData.oldPullRequests).toEqual(prs);
        expect(storedData.lastUpdated).toBe(FIXED_TIME.toISOString());
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'DATA_UPDATED',
            timestamp: FIXED_TIME.getTime(),
        });
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                title: 'New Pull Requests',
                message: 'You have 1 new pull request!',
            })
        );
    });

    it('suppresses the next refresh after a successful optional rate limit', async () => {
        vi.mocked(getActiveGitHubRateLimitCooldown)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(COOLDOWN);
        vi.mocked(fetchPullRequests).mockResolvedValue(
            successfulFetch([pullRequest(1)], COOLDOWN)
        );

        await checkPullRequests(true);
        await checkPullRequests(false);

        expect(fetch).toHaveBeenCalledOnce();
        expect(fetchPullRequests).toHaveBeenCalledOnce();
        expect(persistGitHubRateLimitCooldown).toHaveBeenCalledWith(COOLDOWN);
        expect(clearGitHubRateLimitCooldown).not.toHaveBeenCalled();
    });

    it('does not manufacture a cooldown for a non-rate-limit refresh failure', async () => {
        vi.mocked(fetchPullRequests).mockResolvedValue({ status: 'failure' });

        await checkPullRequests(true);

        expect(persistGitHubRateLimitCooldown).not.toHaveBeenCalled();
    });

    it('preserves cached and notification state when required PR details are incomplete', async () => {
        const cachedPrs = [pullRequest(1), pullRequest(2)];
        const previousPrs = [pullRequest(1)];
        storedData = appData({
            pullRequests: cachedPrs,
            oldPullRequests: previousPrs,
        });
        const originalData = clone(storedData);
        vi.mocked(fetchPullRequests).mockResolvedValue({ status: 'failure' });

        await checkPullRequests(true);

        expect(storedData).toEqual(originalData);
        expect(setBadgeText).not.toHaveBeenCalled();
        expect(encryptAppData).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DATA_UPDATED' })
        );
        expect(state.lastNewPRNotificationTime).toBe(0);
    });

    it('recovers normally after an incomplete detail refresh', async () => {
        const cachedPrs = [pullRequest(1), pullRequest(2)];
        const recoveredPrs = [...cachedPrs, pullRequest(3)];
        storedData = appData({
            pullRequests: cachedPrs,
            oldPullRequests: cachedPrs,
        });
        vi.mocked(fetchPullRequests)
            .mockResolvedValueOnce({ status: 'failure' })
            .mockResolvedValueOnce(successfulFetch(recoveredPrs));

        await checkPullRequests(true);
        vi.advanceTimersByTime(4000);
        await checkPullRequests(true);

        expect(fetchPullRequests).toHaveBeenCalledTimes(2);
        expect(setBadgeText).toHaveBeenCalledOnce();
        expect(setBadgeText).toHaveBeenCalledWith('3');
        expect(storedData.pullRequests).toEqual(recoveredPrs);
        expect(storedData.oldPullRequests).toEqual(recoveredPrs);
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                title: 'New Pull Requests',
                message: 'You have 1 new pull request!',
            })
        );
    });

    it('persists and publishes a successful empty search result', async () => {
        const cachedPrs = [pullRequest(1), pullRequest(2)];
        storedData = appData({
            pullRequests: cachedPrs,
            oldPullRequests: cachedPrs,
        });
        vi.mocked(fetchPullRequests).mockResolvedValue(successfulFetch([]));

        await checkPullRequests(true);

        expect(setBadgeText).toHaveBeenCalledWith('');
        expect(storedData.pullRequests).toEqual([]);
        expect(storedData.oldPullRequests).toEqual([]);
        expect(storedData.lastUpdated).toBe(FIXED_TIME.toISOString());
        expect(encryptAppData).toHaveBeenCalledTimes(2);
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'DATA_UPDATED',
            timestamp: FIXED_TIME.getTime(),
        });
        expect(state.isCheckingPRs).toBe(false);
    });

    it('uses an explicit message query instead of the persisted custom query', async () => {
        storedData = appData({
            preferences: { customQuery: 'is:pr org:stored' },
        });

        await checkPullRequests(true, 'is:pr org:message');

        expect(fetchPullRequests).toHaveBeenCalledWith(
            TOKEN,
            { login: 'octo-user' },
            'is:pr org:message',
            createNotification
        );
    });

    it('notifies only for IDs absent from a non-empty previous snapshot', async () => {
        storedData = appData({ oldPullRequests: [pullRequest(1)] });
        vi.mocked(fetchPullRequests).mockResolvedValue(
            successfulFetch([pullRequest(1), pullRequest(2), pullRequest(3)])
        );

        await checkPullRequests(true);

        expect(createNotification).toHaveBeenCalledWith(undefined, {
            type: 'basic',
            iconUrl: constants.NOTIFICATION_ICON,
            title: 'New Pull Requests',
            message: 'You have 2 new pull requests!',
        });
        expect(state.lastNewPRNotificationTime).toBe(FIXED_TIME.getTime());
    });

    it('does not notify on first run by default', async () => {
        vi.mocked(fetchPullRequests).mockResolvedValue(
            successfulFetch([pullRequest(1)])
        );

        await checkPullRequests(true);

        expect(browser.storage.local.get).toHaveBeenCalledWith(
            'prtracker-notify-on-first-run'
        );
        expect(createNotification).not.toHaveBeenCalled();
    });

    it('notifies on first run only when the separate local flag is true', async () => {
        vi.mocked(fetchPullRequests).mockResolvedValue(
            successfulFetch([pullRequest(1)])
        );
        vi.mocked(browser.storage.local.get).mockResolvedValue({
            'prtracker-notify-on-first-run': true,
        });

        await checkPullRequests(true);

        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                title: 'New Pull Requests',
                message: 'You have 1 new pull request!',
            })
        );
    });

    it('applies separately stored hidden IDs to the advanced old snapshot', async () => {
        const visible = pullRequest(1);
        const hidden = pullRequest(2);
        storedData = appData({ oldPullRequests: [visible] });
        vi.mocked(fetchPullRequests).mockResolvedValue(
            successfulFetch([visible, hidden])
        );
        vi.mocked(decryptHiddenPrIds).mockResolvedValue([2]);

        await checkPullRequests(true);

        expect(storedData.pullRequests.map(({ id }) => id)).toEqual([1, 2]);
        expect(storedData.pullRequests[0]).not.toHaveProperty('hidden');
        expect(storedData.pullRequests[1]).not.toHaveProperty('hidden');
        expect(storedData.oldPullRequests?.map(({ id }) => id)).toEqual([1, 2]);
        expect(storedData.oldPullRequests?.[0]).not.toHaveProperty('hidden');
        expect(storedData.oldPullRequests?.[1]).toHaveProperty('hidden', true);
    });

    it('advances the snapshot when the manager throttle suppresses a grouped notification', async () => {
        storedData = appData({ oldPullRequests: [pullRequest(1)] });
        const firstPrs = [pullRequest(1), pullRequest(2)];
        const throttledPrs = [...firstPrs, pullRequest(3), pullRequest(4)];
        vi.mocked(fetchPullRequests)
            .mockResolvedValueOnce(successfulFetch(firstPrs))
            .mockResolvedValueOnce(successfulFetch(throttledPrs))
            .mockResolvedValueOnce(successfulFetch(throttledPrs));

        await checkPullRequests(true);
        vi.advanceTimersByTime(5000);
        await checkPullRequests(true);

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(createNotification).toHaveBeenCalledWith(undefined, {
            type: 'basic',
            iconUrl: constants.NOTIFICATION_ICON,
            title: 'New Pull Requests',
            message: 'You have 1 new pull request!',
        });
        expect(storedData.pullRequests).toEqual(throttledPrs);
        expect(storedData.oldPullRequests).toEqual(throttledPrs);
        expect(storedData.lastUpdated).toBe(
            new Date(FIXED_TIME.getTime() + 5000).toISOString()
        );
        expect(setBadgeText).toHaveBeenLastCalledWith('4');
        expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith({
            type: 'DATA_UPDATED',
            timestamp: FIXED_TIME.getTime() + 5000,
        });
        expect(encryptAppData).toHaveBeenCalledTimes(4);

        // Once the display throttle expires, the same PRs are no longer new.
        vi.advanceTimersByTime(constants.NOTIFICATION_THROTTLE_MS - 5000);
        await checkPullRequests(true);

        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(storedData.oldPullRequests).toEqual(throttledPrs);
        expect(encryptAppData).toHaveBeenCalledTimes(6);
    });

    it('advances successful refresh state when notification delivery rejects', async () => {
        const prs = [pullRequest(1), pullRequest(2)];
        storedData = appData({ oldPullRequests: [pullRequest(1)] });
        vi.mocked(fetchPullRequests).mockResolvedValue(successfulFetch(prs));
        vi.mocked(createNotification).mockRejectedValueOnce(
            new Error('Notification API unavailable')
        );

        await checkPullRequests(true);

        expect(createNotification).toHaveBeenCalledOnce();
        expect(storedData.pullRequests).toEqual(prs);
        expect(storedData.oldPullRequests).toEqual(prs);
        expect(storedData.lastUpdated).toBe(FIXED_TIME.toISOString());
        expect(setBadgeText).toHaveBeenCalledWith('2');
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'DATA_UPDATED',
            timestamp: FIXED_TIME.getTime(),
        });
        expect(encryptAppData).toHaveBeenCalledTimes(2);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to send notification:',
            expect.objectContaining({ message: 'Notification API unavailable' })
        );
    });

    it.each([
        {
            label: 'manual caller during an automatic refresh',
            firstIsManual: false,
            secondIsManual: true,
        },
        {
            label: 'automatic caller during a manual refresh',
            firstIsManual: true,
            secondIsManual: false,
        },
        {
            label: 'second manual caller during a manual refresh',
            firstIsManual: true,
            secondIsManual: true,
        },
        {
            label: 'second automatic caller during an automatic refresh',
            firstIsManual: false,
            secondIsManual: false,
        },
    ])('reuses the active operation for $label', async (scenario) => {
        const fetchResult = deferred<ReturnType<typeof successfulFetch>>();
        vi.mocked(fetchPullRequests).mockReturnValue(fetchResult.promise);

        const firstRefresh = checkPullRequests(scenario.firstIsManual);
        await vi.waitFor(() => {
            expect(fetchPullRequests).toHaveBeenCalledOnce();
        });

        const secondRefresh = checkPullRequests(scenario.secondIsManual);

        expect(secondRefresh).toBe(firstRefresh);
        expect(fetchPullRequests).toHaveBeenCalledOnce();
        expect(state.isCheckingPRs).toBe(true);

        fetchResult.resolve(successfulFetch([pullRequest(1)]));
        await expect(
            Promise.all([firstRefresh, secondRefresh])
        ).resolves.toEqual([undefined, undefined]);
        expect(state.isCheckingPRs).toBe(false);
    });

    it('starts a later refresh after successful in-flight cleanup', async () => {
        const firstFetch = deferred<ReturnType<typeof successfulFetch>>();
        vi.mocked(fetchPullRequests).mockReturnValueOnce(firstFetch.promise);

        const firstRefresh = checkPullRequests(true);
        await vi.waitFor(() => {
            expect(fetchPullRequests).toHaveBeenCalledOnce();
        });
        firstFetch.resolve(successfulFetch([pullRequest(1)]));
        await firstRefresh;

        vi.advanceTimersByTime(4000);
        vi.mocked(fetchPullRequests).mockResolvedValueOnce(
            successfulFetch([pullRequest(2)])
        );
        await checkPullRequests(true);

        expect(fetchPullRequests).toHaveBeenCalledTimes(2);
        expect(state.isCheckingPRs).toBe(false);
    });

    it('refuses test-state reset during an active refresh and resets throttles after completion', async () => {
        const activeFetch = deferred<ReturnType<typeof successfulFetch>>();
        vi.mocked(fetchPullRequests).mockReturnValueOnce(activeFetch.promise);

        const refresh = checkPullRequests(true);
        await vi.waitFor(() => {
            expect(fetchPullRequests).toHaveBeenCalledOnce();
        });

        expect(resetPullRequestManagerStateForTests()).toBe(false);

        activeFetch.resolve(successfulFetch([pullRequest(1)]));
        await refresh;
        state.lastRefreshTime = FIXED_TIME.getTime();
        state.lastNewPRNotificationTime = FIXED_TIME.getTime();
        (globalThis as { _prTrackerLastManual?: number })._prTrackerLastManual =
            FIXED_TIME.getTime();

        expect(resetPullRequestManagerStateForTests()).toBe(true);
        expect(state.lastRefreshTime).toBe(0);
        expect(state.lastNewPRNotificationTime).toBe(0);
        expect(
            (globalThis as { _prTrackerLastManual?: number })
                ._prTrackerLastManual
        ).toBeUndefined();
    });

    it('shares a failed operation and permits a later refresh', async () => {
        const firstFetch = deferred<ReturnType<typeof successfulFetch>>();
        vi.mocked(fetchPullRequests).mockReturnValueOnce(firstFetch.promise);

        const firstRefresh = checkPullRequests(true);
        await vi.waitFor(() => {
            expect(fetchPullRequests).toHaveBeenCalledOnce();
        });
        const secondRefresh = checkPullRequests();
        expect(secondRefresh).toBe(firstRefresh);

        firstFetch.reject(new Error('GitHub unavailable'));
        await expect(
            Promise.all([firstRefresh, secondRefresh])
        ).resolves.toEqual([undefined, undefined]);
        expect(createNotification).toHaveBeenCalledTimes(1);
        expect(state.isCheckingPRs).toBe(false);

        vi.advanceTimersByTime(4000);
        vi.mocked(fetchPullRequests).mockResolvedValueOnce(
            successfulFetch([pullRequest(2)])
        );
        await checkPullRequests(true);

        expect(fetchPullRequests).toHaveBeenCalledTimes(2);
        expect(state.isCheckingPRs).toBe(false);
    });

    it('enforces automatic and manual refresh throttles with a frozen clock', async () => {
        await checkPullRequests();
        expect(fetchPullRequests).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(10_000);
        await checkPullRequests();
        expect(fetchPullRequests).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(constants.REFRESH_INTERVAL - 10_000);
        await checkPullRequests();
        expect(fetchPullRequests).toHaveBeenCalledTimes(2);

        await checkPullRequests(true);
        await checkPullRequests(true);
        expect(fetchPullRequests).toHaveBeenCalledTimes(3);
        vi.advanceTimersByTime(4000);
        await checkPullRequests(true);
        expect(fetchPullRequests).toHaveBeenCalledTimes(4);
    });

    it('restores a session password before polling', async () => {
        state.sessionPassword = null;
        vi.mocked(browser.storage.session.get).mockResolvedValue({
            sessionPassword: 'restored-password',
        });

        await checkPullRequests(true);

        expect(state.sessionPassword).toBe('restored-password');
        expect(decryptToken).toHaveBeenCalledWith('restored-password');
    });

    it('force-shows and publishes a missing-session error', async () => {
        state.sessionPassword = null;

        await checkPullRequests(true);

        const message =
            'Session expired or password missing. Please sign in again.';
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            {
                type: 'basic',
                iconUrl: constants.NOTIFICATION_ICON,
                title: 'PR Tracker Error',
                message,
            },
            true
        );
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message,
        });
        expect(decryptToken).not.toHaveBeenCalled();
        expect(state.isCheckingPRs).toBe(false);
    });

    it('returns silently when the encrypted token cannot be decrypted', async () => {
        vi.mocked(decryptToken).mockResolvedValue(null);

        await checkPullRequests(true);

        expect(fetch).not.toHaveBeenCalled();
        expect(createNotification).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('delegates a failed user lookup to API error handling and stops', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('Unauthorized', { status: 401 }))
        );

        await checkPullRequests(true);

        expect(handleApiError).toHaveBeenCalledWith(
            expect.objectContaining({ status: 401 }),
            createNotification,
            'User info fetch'
        );
        expect(fetchPullRequests).not.toHaveBeenCalled();
        expect(persistGitHubRateLimitCooldown).not.toHaveBeenCalled();
    });

    it('persists a required user-request cooldown before stopping', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('rate limited', { status: 429 }))
        );
        vi.mocked(handleApiError).mockResolvedValue({
            message: 'GitHub API rate limit exceeded.',
            isRateLimit: true,
            isAuth: false,
            rateLimit: COOLDOWN,
        });

        await checkPullRequests(true);

        expect(persistGitHubRateLimitCooldown).toHaveBeenCalledWith(COOLDOWN);
        expect(fetchPullRequests).not.toHaveBeenCalled();
        expect(setBadgeText).not.toHaveBeenCalled();
        expect(encryptAppData).not.toHaveBeenCalled();
    });

    it('reports unexpected polling failures to the notification and popup paths', async () => {
        vi.mocked(fetchPullRequests).mockRejectedValue(
            new Error('GitHub unavailable')
        );

        await checkPullRequests(true);

        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            {
                type: 'basic',
                iconUrl: constants.NOTIFICATION_ICON,
                title: 'PR Tracker Error',
                message: 'GitHub unavailable',
            },
            false
        );
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message: 'GitHub unavailable',
        });
        expect(state.isCheckingPRs).toBe(false);
    });
});
