import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import {
    installGitHubApiMock,
    openSeededPopup,
    readAppData,
    waitForDashboard,
    waitForText,
    type GitHubMock,
} from './harness.js';

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
});
