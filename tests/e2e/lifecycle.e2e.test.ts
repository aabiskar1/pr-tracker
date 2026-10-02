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
        await reopened.click('[aria-label="Settings"]');
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

    it('signs out, signs back in, and fully resets account data while retaining the theme', async () => {
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
        await page.click('[aria-label="Settings"]');
        expect(
            await page.$eval(
                '[aria-label="Theme selector"]',
                (select) => (select as HTMLSelectElement).value
            )
        ).toBe('dark');

        await page.click('[aria-label="Sign Out"]');
        await waitForText(page, 'h2', 'Enter Password');
        await page.evaluate(async () => {
            await chrome.storage.local.set({
                'prtracker-notify-on-first-run': true,
                prtracker_github_rate_limit_cooldown: {
                    classification: 'primary',
                    deadlineSource: 'reset',
                    nextAllowedAt: Date.now() + 60_000,
                },
            });
            await chrome.notifications.create('reset-visible-notification', {
                type: 'basic',
                iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
                title: 'Reset me',
                message: 'Account notification state',
            });
        });
        await page.click('[aria-label="Full Reset"]');
        await page.waitForSelector('[role="dialog"]');
        await waitForText(page, 'h2', 'Reset PR Tracker?');
        await page.waitForFunction(
            () => document.activeElement?.textContent === 'Cancel'
        );
        expect(
            await page.$eval('[role="dialog"]', (dialog) => dialog.textContent)
        ).toContain('Your theme preference will be retained.');
        expect(
            await page.evaluate(() =>
                chrome.storage.local.get('encryptedGithubToken')
            )
        ).toHaveProperty('encryptedGithubToken');
        expect(
            await page.$eval(
                '[role="dialog"] button:focus',
                (button) => button.textContent
            )
        ).toBe('Cancel');

        await page.click('[role="dialog"] button');
        await page.waitForSelector('[role="dialog"]', { hidden: true });
        expect(
            await page.evaluate(() => document.activeElement?.textContent)
        ).toBe('Full Reset');
        expect(
            await page.evaluate(() =>
                chrome.storage.local.get('encryptedGithubToken')
            )
        ).toHaveProperty('encryptedGithubToken');

        await page.click('[aria-label="Full Reset"]');
        await page.waitForSelector('[role="dialog"]');
        await page.keyboard.press('Escape');
        await page.waitForSelector('[role="dialog"]', { hidden: true });
        expect(
            await page.evaluate(() => document.activeElement?.textContent)
        ).toBe('Full Reset');
        expect(
            await page.evaluate(() =>
                chrome.storage.local.get('encryptedGithubToken')
            )
        ).toHaveProperty('encryptedGithubToken');

        await page.click('[aria-label="Full Reset"]');
        await page.waitForSelector('[role="dialog"]');
        await page.click('[role="dialog"] button:last-child');
        await waitForText(page, 'h2', 'GitHub Authentication');
        expect(
            await page.evaluate(() => chrome.storage.local.get(null))
        ).toEqual({ 'theme-preference': 'dark' });
        expect(
            await page.evaluate(() => chrome.storage.session.get(null))
        ).toEqual({});
        expect(await page.evaluate(() => chrome.alarms.getAll())).toEqual([]);
        expect(
            await page.evaluate(() => chrome.notifications.getAll())
        ).toEqual({});
    });

    it('locks and aborts an automatic refresh before later requests or side effects', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        await waitForDashboard(page);
        const baseline = await page.evaluate(async () => ({
            appData: await chrome.storage.local.get([
                'encryptedAppData',
                'appDataIv',
            ]),
            badge: await chrome.action.getBadgeText({}),
            notifications: await chrome.notifications.getAll(),
        }));
        expect(
            await page.evaluate(() =>
                chrome.runtime.sendMessage({
                    type: 'TEST_RESET_BACKGROUND_STATE',
                })
            )
        ).toBe(true);
        github.resetRequests();
        const pausedUser = github.pauseNextUserRequest();

        await page.evaluate(() => {
            (
                globalThis as typeof globalThis & {
                    __sessionLockRefresh?: Promise<unknown>;
                }
            ).__sessionLockRefresh = chrome.runtime.sendMessage({
                type: 'CHECK_PRS',
            });
        });
        await pausedUser.reached;

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

        pausedUser.release();
        await page.evaluate(async () => {
            await (
                globalThis as typeof globalThis & {
                    __sessionLockRefresh?: Promise<unknown>;
                }
            ).__sessionLockRefresh;
        });

        expect(github.requests).toEqual(['https://api.github.com/user']);
        expect(
            await page.evaluate(async () => ({
                appData: await chrome.storage.local.get([
                    'encryptedAppData',
                    'appDataIv',
                ]),
                badge: await chrome.action.getBadgeText({}),
                notifications: await chrome.notifications.getAll(),
            }))
        ).toEqual(baseline);

        await page.type('#currentPassword', TEST_PASSWORD);
        await page.click('[aria-label="Sign In"]');
        await waitForDashboard(page);
        expect(github.requests.length).toBeGreaterThan(1);
    });

    it.each(['click', 'keyboard'] as const)(
        'opens the coffee page exactly once through the tabs API on %s activation',
        async (activation) => {
            const page = await openSeededPopup(github);
            pages.push(page);
            const requests: chrome.tabs.CreateProperties[] = [];
            await page.exposeFunction(
                'recordSupportTab',
                (properties: chrome.tabs.CreateProperties) => {
                    requests.push(properties);
                }
            );
            await page.evaluate(() => {
                // Keep this deterministic: exercise the extension API call without
                // navigating to the third-party donation site.
                chrome.tabs.create = (async (
                    properties: chrome.tabs.CreateProperties
                ) => {
                    await (
                        window as unknown as {
                            recordSupportTab: (
                                properties: chrome.tabs.CreateProperties
                            ) => Promise<void>;
                        }
                    ).recordSupportTab(properties);
                    return { id: 99 };
                }) as typeof chrome.tabs.create;
            });
            const selector = '[aria-label="Open Buy Me a Coffee page"]';
            await page.waitForSelector(selector);
            expect(
                await page.$eval(selector, (button) => ({
                    text: button.textContent?.trim(),
                    title: button.getAttribute('title'),
                    decorativeIcon: button
                        .querySelector('svg')
                        ?.getAttribute('aria-hidden'),
                }))
            ).toEqual({
                text: '',
                title: 'Buy me a coffee',
                decorativeIcon: 'true',
            });
            if (activation === 'click') {
                await page.click(selector);
            } else {
                await page.focus(selector);
                expect(
                    await page.$eval(
                        selector,
                        (button) => getComputedStyle(button).boxShadow
                    )
                ).not.toBe('none');
                await page.keyboard.press('Enter');
            }
            await expect
                .poll(() => requests)
                .toEqual([
                    { url: 'https://buymeacoffee.com/aabiskar1', active: true },
                ]);
            // Flush the click handler before checking the final count.
            await page.evaluate(
                () =>
                    new Promise<void>((resolve) =>
                        requestAnimationFrame(() => resolve())
                    )
            );
            expect(requests).toHaveLength(1);
            expect(
                await page.$('header [aria-label="Refresh Pull Requests"]')
            ).not.toBeNull();
        }
    );
});
