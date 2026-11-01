import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import type { PullRequest } from '../../src/types';
import { openExtensionPopup } from './setup.js';
import {
    installGitHubApiMock,
    openSeededPopup,
    readAppData,
    resetManualRefreshThrottle,
    waitForDashboard,
    waitForText,
    type GitHubMock,
} from './harness.js';
import { appData, POPULATED_PRS, TEST_PASSWORD } from './fixtures.js';

const reviewedPRs: PullRequest[] = [
    {
        ...POPULATED_PRS[0],
        discoverySources: ['review-requested'],
        review_status: 'changes-requested',
    },
    {
        ...POPULATED_PRS[1],
        discoverySources: ['reviewed'],
        review_status: 'changes-requested',
    },
    {
        ...POPULATED_PRS[2],
        discoverySources: ['reviewed'],
        review_status: 'approved',
    },
    {
        ...POPULATED_PRS[3],
        discoverySources: ['reviewed'],
        review_status: 'pending',
    },
    {
        ...POPULATED_PRS[0],
        id: 105,
        title: 'Authored and reviewed',
        discoverySources: ['authored', 'reviewed'],
    },
    {
        ...POPULATED_PRS[0],
        id: 106,
        title: 'Requested again after review',
        discoverySources: ['review-requested', 'reviewed'],
    },
];
const checked = (page: Page) =>
    page.$eval(
        '[aria-label="Show Reviewed"]',
        (el) => (el as HTMLInputElement).checked
    );
const count = (page: Page, expected: number) =>
    page.waitForFunction(
        (n) => document.querySelectorAll('li').length === n,
        { timeout: 8000 },
        expected
    );
const refresh = async (page: Page) => {
    await resetManualRefreshThrottle();
    await page.click('[aria-label="Refresh Pull Requests"]');
    await page.waitForSelector('[data-screen="loading"]');
    await waitForDashboard(page);
};

describe('reviewed PR retention', () => {
    let github: GitHubMock;
    const pages: Page[] = [];
    beforeAll(async () => {
        github = await installGitHubApiMock();
    });
    afterEach(async () => {
        await Promise.all(pages.splice(0).map((page) => page.close()));
    });
    afterAll(async () => {
        await github.close();
    });

    it('shows the latest review after a second REST page', async () => {
        const pullRequest = POPULATED_PRS[0];
        const page = await openSeededPopup(github, {
            data: appData([pullRequest]),
        });
        pages.push(page);
        await page.evaluate(() =>
            chrome.runtime.sendMessage({ type: 'CHECK_PRS' })
        );
        github.resetRequests();
        github.setScenario({
            pullRequests: [pullRequest],
            reviewHistoryByPrId: {
                [pullRequest.id]: [
                    ...Array.from({ length: 100 }, () => ({
                        user: { id: 1 },
                        state: 'APPROVED',
                    })),
                    { user: { id: 1 }, state: 'CHANGES_REQUESTED' },
                ],
            },
        });
        await refresh(page);
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).pullRequests[0].review_status
            )
            .toBe('changes-requested');
        expect(
            github.requests.filter((url) =>
                url.includes(`/pulls/${pullRequest.id}/reviews?`)
            )
        ).toEqual([
            `https://api.github.com/repos/acme/${pullRequest.repository.name}/pulls/${pullRequest.id}/reviews?per_page=100`,
            `https://api.github.com/repos/acme/${pullRequest.repository.name}/pulls/${pullRequest.id}/reviews?per_page=100&page=2`,
        ]);
        await page.waitForSelector('[aria-label="Review: changes-requested"]');
    });

    it('retains every review outcome, filters cached sources, persists across reopen/unlock, and resets', async () => {
        const page = await openSeededPopup(github, {
            data: appData(reviewedPRs),
        });
        pages.push(page);
        // Wait for authentication-triggered refresh before inspecting request counts.
        await page.evaluate(() =>
            chrome.runtime.sendMessage({ type: 'CHECK_PRS' })
        );
        await count(page, 6);
        expect(await checked(page)).toBe(true);
        expect((await readAppData(page)).pullRequests).toHaveLength(6);
        github.resetRequests();
        await page.click('[aria-label="Show Reviewed"]');
        await count(page, 3);
        for (const title of [
            reviewedPRs[0].title,
            reviewedPRs[4].title,
            reviewedPRs[5].title,
        ])
            await waitForText(page, 'li', title);
        expect(github.requests).toEqual([]);
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.filters?.showReviewed
            )
            .toBe(false);
        await refresh(page);
        await count(page, 3);
        expect((await readAppData(page)).pullRequests).toHaveLength(6);
        expect(
            github.requests.some((url) =>
                new URL(url).searchParams.get('q')?.includes('reviewed-by:')
            )
        ).toBe(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await count(page, 3);
        expect(await checked(page)).toBe(false);
        const reopened = await openExtensionPopup();
        pages.push(reopened);
        await count(reopened, 3);
        expect(await checked(reopened)).toBe(false);
        await reopened.click('[aria-label="Sign Out"]');
        await waitForText(reopened, 'h2', 'Enter Password');
        await reopened.type('#currentPassword', TEST_PASSWORD);
        await reopened.click('[aria-label="Sign In"]');
        await count(reopened, 3);
        expect(await checked(reopened)).toBe(false);
        await reopened.click('button::-p-text(Reset Filters)');
        await count(reopened, 6);
        await expect.poll(() => checked(reopened)).toBe(true);
        await expect
            .poll(
                async () =>
                    (await readAppData(reopened)).preferences?.filters
                        ?.showReviewed
            )
            .toBe(true);
        // Repeated activity still retains all open reviewed PRs with no duplicates.
        github.setScenario({
            pullRequests: reviewedPRs.map((pr) => ({
                ...pr,
                title: `${pr.title} updated`,
            })),
        });
        await refresh(reopened);
        await count(reopened, 6);
        await waitForText(reopened, 'li', `${reviewedPRs[1].title} updated`);
        const stored = await readAppData(reopened);
        expect(
            stored.pullRequests.find((pr) => pr.id === 105)?.discoverySources
        ).toEqual(['authored', 'reviewed']);
        expect(new Set(stored.pullRequests.map((pr) => pr.id)).size).toBe(6);
    });

    it('upgrades legacy encrypted filters without resetting preferences', async () => {
        const data = appData([POPULATED_PRS[0]]);
        Reflect.deleteProperty(data.preferences!.filters!, 'showReviewed');
        data.preferences!.sort = 'oldest';
        data.preferences!.notificationsEnabled = false;
        const page = await openSeededPopup(github, { data });
        pages.push(page);
        expect(await checked(page)).toBe(true);
        expect(
            await page.$eval(
                '[aria-label="Sort pull requests"]',
                (el) => (el as HTMLSelectElement).value
            )
        ).toBe('oldest');
        await page.click('[aria-label="Show Reviewed"]');
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.filters?.showReviewed
            )
            .toBe(false);
        expect((await readAppData(page)).preferences).toMatchObject({
            sort: 'oldest',
            notificationsEnabled: false,
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForDashboard(page);
        await expect.poll(() => checked(page)).toBe(false);
    });

    it.each(['merged', 'closed'])(
        'removes a %s PR on successful refresh and preserves the snapshot on failure',
        async (kind) => {
            const page = await openSeededPopup(github, {
                data: appData(reviewedPRs),
            });
            pages.push(page);
            await page.evaluate(() =>
                chrome.runtime.sendMessage({ type: 'CHECK_PRS' })
            );
            const before = await readAppData(page);
            github.setScenario({
                pullRequests: reviewedPRs,
                detailStatusByPrId: { 102: 503 },
            });
            await refresh(page);
            await waitForText(
                page,
                '[role="alert"]',
                'could not be refreshed completely'
            );
            expect((await readAppData(page)).pullRequests).toEqual(
                before.pullRequests
            );
            github.setScenario({
                pullRequests: reviewedPRs.map((pr) =>
                    pr.id === 102
                        ? { ...pr, state: 'closed', merged: kind === 'merged' }
                        : pr
                ),
            });
            await refresh(page);
            await count(page, 5);
            expect(
                (await readAppData(page)).pullRequests.some(
                    (pr) => pr.id === 102
                )
            ).toBe(false);
        }
    );

    it('keeps custom search semantics with Reviewed unchecked', async () => {
        const page = await openSeededPopup(github, {
            data: appData(reviewedPRs),
        });
        pages.push(page);
        await page.evaluate(() =>
            chrome.runtime.sendMessage({ type: 'CHECK_PRS' })
        );
        await page.click('[aria-label="Show Reviewed"]');
        await count(page, 3);
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.filters?.showReviewed
            )
            .toBe(false);
        await page.type(
            '[aria-label="Custom GitHub search query"]',
            'is:pr reviewed-by:fixture-user'
        );
        await resetManualRefreshThrottle();
        github.resetRequests();
        await page.click('[aria-label="Save custom search query"]');
        await count(page, 5);
        const stored = await readAppData(page);
        expect(
            stored.pullRequests.every((pr) => pr.discoverySources === undefined)
        ).toBe(true);
        const queries = github.requests
            .filter((url) => url.includes('/search/issues'))
            .map((url) => new URL(url).searchParams.get('q'));
        expect(queries).toEqual(['is:pr reviewed-by:fixture-user']);
        expect(await checked(page)).toBe(false);
    });

    it('baselines historical discoveries without pending notification spam', async () => {
        const data = appData([reviewedPRs[0]]);
        data.preferences!.notificationsEnabled = false;
        const page = await openSeededPopup(github, { data });
        pages.push(page);
        await page.evaluate(() =>
            chrome.runtime.sendMessage({ type: 'CHECK_PRS' })
        );
        github.setScenario({ pullRequests: reviewedPRs.slice(0, 4) });
        await refresh(page);
        await count(page, 4);
        expect(
            (await readAppData(page)).pendingNotificationPullRequestIds
        ).toEqual([]);
        expect(
            await page.evaluate(() => chrome.notifications.getAll())
        ).toEqual({});
        // Only the new, relevant outstanding request becomes pending.
        github.setScenario({ pullRequests: reviewedPRs });
        await refresh(page);
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).pendingNotificationPullRequestIds
            )
            .toEqual([105, 106]);
    });
});
