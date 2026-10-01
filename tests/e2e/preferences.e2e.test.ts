import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
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
import { POPULATED_PRS } from './fixtures.js';

describe('preference persistence journeys', () => {
    let github: GitHubMock;
    const pages: Page[] = [];

    beforeAll(async () => {
        github = await installGitHubApiMock();
    });

    afterEach(async () => {
        await Promise.all(pages.splice(0).map((page) => page.close()));
    });

    afterAll(async () => {
        await Promise.all(pages.map((page) => page.close()));
        await github.close();
    });

    it('restores notification, filter, sort, custom-query, and theme choices after reload', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        await page.click('[aria-label="Disable notifications"]');
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.notificationsEnabled
            )
            .toBe(false);
        await page.click('[aria-label="Show Drafts"]');
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.filters?.showDrafts
            )
            .toBe(false);
        await page.select('[aria-label="Sort pull requests"]', 'oldest');
        await expect
            .poll(async () => (await readAppData(page)).preferences?.sort)
            .toBe('oldest');
        await page.type(
            '[aria-label="Custom GitHub search query"]',
            'is:open is:pr org:acme'
        );
        await page.click('[aria-label="Save custom search query"]');
        await expect
            .poll(
                async () => (await readAppData(page)).preferences?.customQuery
            )
            .toBe('is:open is:pr org:acme');
        await page.waitForSelector('[data-screen="loading"]');
        await waitForDashboard(page);
        await page.select('[aria-label="Theme selector"]', 'dark');
        await page.waitForFunction(
            () => document.documentElement.getAttribute('data-theme') === 'dark'
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForDashboard(page);
        await page.waitForSelector('[aria-label="Enable notifications"]');

        expect(
            await page.$('[aria-label="Enable notifications"]')
        ).not.toBeNull();
        expect(
            await page.$eval(
                '[aria-label="Show Drafts"]',
                (input) => (input as HTMLInputElement).checked
            )
        ).toBe(false);
        expect(
            await page.$eval(
                '[aria-label="Sort pull requests"]',
                (select) => (select as HTMLSelectElement).value
            )
        ).toBe('oldest');
        expect(
            await page.$eval(
                '[aria-label="Custom GitHub search query"]',
                (input) => (input as HTMLInputElement).value
            )
        ).toBe('is:open is:pr org:acme');
        expect(
            await page.$eval(
                '[aria-label="Theme selector"]',
                (select) => (select as HTMLSelectElement).value
            )
        ).toBe('dark');
    });

    it('follows system changes after switching from an explicit theme to automatic', async () => {
        const page = await openSeededPopup(github, { theme: 'light' });
        pages.push(page);
        await page.emulateMediaFeatures([
            { name: 'prefers-color-scheme', value: 'dark' },
        ]);
        await page.select('[aria-label="Theme selector"]', 'auto');
        await page.waitForFunction(
            () => document.documentElement.getAttribute('data-theme') === 'dark'
        );

        await page.emulateMediaFeatures([
            { name: 'prefers-color-scheme', value: 'light' },
        ]);
        await page.waitForFunction(
            () =>
                document.documentElement.getAttribute('data-theme') === 'light'
        );

        expect(
            await page.evaluate(() =>
                chrome.storage.local.get('theme-preference')
            )
        ).toEqual({ 'theme-preference': 'auto' });
    });

    it('persists hide and unhide state across popup reloads', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        const initialCount = (await page.$$('li')).length;

        await page.click('[aria-label="Hide PR"]');
        await page.waitForFunction(
            (count) => document.querySelectorAll('li').length === count - 1,
            {},
            initialCount
        );
        await expect
            .poll(async () => (await readAppData(page)).pullRequests[0].hidden)
            .toBe(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForDashboard(page);
        await page.waitForFunction(
            (count) => document.querySelectorAll('li').length === count - 1,
            {},
            initialCount
        );
        expect(await page.$$('li')).toHaveLength(initialCount - 1);

        await page.click('[aria-label="Show Hidden"]');
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.filters?.showHidden
            )
            .toBe(true);
        await page.waitForFunction(
            (count) => document.querySelectorAll('li').length === count,
            {},
            initialCount
        );
        await page.waitForSelector('[aria-label="Unhide PR"]');
        await page.click('[aria-label="Unhide PR"]');
        await expect
            .poll(async () => (await readAppData(page)).pullRequests[0].hidden)
            .toBe(false);
        await page.waitForSelector('[aria-label="Unhide PR"]', {
            hidden: true,
        });
        await page.click('[aria-label="Show Hidden"]');
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.filters?.showHidden
            )
            .toBe(false);
        await waitForText(page, 'li', 'Add new authentication flow');
        expect(await page.$$('li')).toHaveLength(initialCount);
    });

    it('replays one grouped notification for PRs discovered while notifications were disabled', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        await page.click('[aria-label="Disable notifications"]');
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.notificationsEnabled
            )
            .toBe(false);

        const missedPullRequests = [
            ...POPULATED_PRS,
            {
                ...POPULATED_PRS[0],
                id: 201,
                title: 'First missed notification',
                html_url: 'https://github.com/acme/auth-service/pull/201',
            },
            {
                ...POPULATED_PRS[0],
                id: 202,
                title: 'Second missed notification',
                html_url: 'https://github.com/acme/auth-service/pull/202',
            },
        ];
        github.setScenario({ pullRequests: missedPullRequests });
        await resetManualRefreshThrottle();
        await page.click('[aria-label="Refresh Pull Requests"]');
        await page.waitForSelector('[data-screen="loading"]');
        await waitForDashboard(page);

        await expect
            .poll(
                async () =>
                    (await readAppData(page)).pendingNotificationPullRequestIds
            )
            .toEqual([201, 202]);
        expect(
            await page.evaluate(() => chrome.notifications.getAll())
        ).toEqual({});

        await page.close();
        pages.splice(pages.indexOf(page), 1);
        const reopened = await openExtensionPopup();
        pages.push(reopened);
        await waitForDashboard(reopened);
        await reopened.waitForSelector('[aria-label="Enable notifications"]');
        await reopened.click('[aria-label="Enable notifications"]');

        await expect
            .poll(() =>
                reopened.evaluate(
                    async () =>
                        Object.keys(await chrome.notifications.getAll()).length
                )
            )
            .toBe(1);
        await expect
            .poll(
                async () =>
                    (await readAppData(reopened))
                        .pendingNotificationPullRequestIds
            )
            .toEqual([]);

        await reopened.evaluate(async () => {
            const notifications = await chrome.notifications.getAll();
            await Promise.all(
                Object.keys(notifications).map((id) =>
                    chrome.notifications.clear(id)
                )
            );
        });
        await resetManualRefreshThrottle();
        expect(
            await reopened.evaluate(() =>
                chrome.runtime.sendMessage({
                    type: 'CHECK_PRS',
                    manual: true,
                })
            )
        ).toBe(true);
        expect(
            await reopened.evaluate(() => chrome.notifications.getAll())
        ).toEqual({});
    });
});
