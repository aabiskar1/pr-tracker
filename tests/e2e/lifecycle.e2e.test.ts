import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { openExtensionPopup } from './setup.js';
import {
    clearExtensionState,
    installGitHubApiMock,
    openSeededPopup,
    waitForDashboard,
    waitForText,
    type GitHubMock,
} from './harness.js';
import { TEST_PASSWORD } from './fixtures.js';

describe('sign-out, reset, and popup lifecycle journeys', () => {
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

    it('retains a remembered session across popup close, reopen, and reload', async () => {
        const first = await openSeededPopup(github, { theme: 'dark' });
        await waitForDashboard(first);
        await first.close();

        const reopened = await openExtensionPopup();
        pages.push(reopened);
        await waitForDashboard(reopened);
        expect(
            await reopened.$eval(
                '[aria-label="Theme selector"]',
                (select) => (select as HTMLSelectElement).value
            )
        ).toBe('dark');

        await reopened.reload({ waitUntil: 'domcontentloaded' });
        await waitForDashboard(reopened);
        await waitForText(reopened, 'li', 'Add new authentication flow');
        expect(await reopened.$$('li')).not.toHaveLength(0);
    });

    it('clears extension storage, alarms, and visible notifications for a fresh scenario', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        await page.evaluate(async () => {
            chrome.alarms.create('test-scenario-alarm', {
                delayInMinutes: 5,
            });
            await chrome.notifications.create('test-scenario-notification', {
                type: 'basic',
                iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
                title: 'Scenario state',
                message: 'Must be cleared',
            });
        });

        await clearExtensionState(page);

        expect(
            await page.evaluate(() => chrome.storage.local.get(null))
        ).toEqual({});
        expect(
            await page.evaluate(() => chrome.storage.session.get(null))
        ).toEqual({});
        expect(await page.evaluate(() => chrome.alarms.getAll())).toEqual([]);
        expect(
            await page.evaluate(() => chrome.notifications.getAll())
        ).toEqual({});
    });

    it('signs out to password entry, signs back in, and fully resets to login', async () => {
        const page = await openSeededPopup(github, { theme: 'dark' });
        pages.push(page);

        await page.click('[aria-label="Sign Out"]');
        await waitForText(page, 'h2', 'Enter Password');
        expect(
            await page.evaluate(() => chrome.storage.session.get(null))
        ).toEqual({});
        expect(
            await page.evaluate(() =>
                chrome.storage.local.get('encryptedGithubToken')
            )
        ).toHaveProperty('encryptedGithubToken');

        await page.type('#currentPassword', TEST_PASSWORD);
        await page.click('[aria-label="Sign In"]');
        await waitForDashboard(page);
        expect(
            await page.$eval(
                '[aria-label="Theme selector"]',
                (select) => (select as HTMLSelectElement).value
            )
        ).toBe('dark');

        await page.click('[aria-label="Sign Out"]');
        await waitForText(page, 'h2', 'Enter Password');
        page.once('dialog', (dialog) => dialog.accept());
        await page.click('[aria-label="Reset App"]');
        await waitForText(page, 'h2', 'GitHub Authentication');
        expect(
            await page.evaluate(() =>
                chrome.storage.local.get('encryptedGithubToken')
            )
        ).toEqual({});
    });

    it('exposes safe external destinations without loading third-party pages', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);

        expect(
            await page.$eval('[aria-label="Buy me a coffee"]', (anchor) => ({
                href: anchor.href,
                target: anchor.target,
            }))
        ).toEqual({
            href: 'https://buymeacoffee.com/aabiskar1',
            target: '_blank',
        });
    });
});
