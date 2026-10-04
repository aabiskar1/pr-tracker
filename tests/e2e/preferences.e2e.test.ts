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

    it.each(['light', 'dark'] as const)(
        'keeps the header compact and Settings keyboard accessible in %s',
        async (theme) => {
            const page = await openSeededPopup(github, { theme });
            pages.push(page);
            await page.$eval('header img', (image) =>
                (image as HTMLImageElement).decode()
            );
            const manifestIcons = await page.evaluate(() => {
                const manifest = chrome.runtime.getManifest();
                return {
                    icons: manifest.icons,
                    toolbar: manifest.action?.default_icon,
                };
            });
            const originalIcons = {
                16: '/icons/icon-16.png',
                32: '/icons/icon-32.png',
                48: '/icons/icon-48.png',
                128: '/icons/icon-128.png',
            };
            expect(manifestIcons).toEqual({
                icons: originalIcons,
                toolbar: originalIcons,
            });
            for (const width of [750]) {
                for (const fontFamily of [
                    'system-ui',
                    'Arial, sans-serif',
                    'monospace',
                ]) {
                    await page.setViewport({ width, height: 600 });
                    await page.evaluate((font) => {
                        document.querySelector<HTMLElement>(
                            'header'
                        )!.style.fontFamily = font;
                    }, fontFamily);
                    const layout = await page.evaluate(() => {
                        const header = document.querySelector('header')!;
                        const title = header
                            .querySelector('h2')!
                            .getBoundingClientRect();

                        const checked = header.querySelector(
                            '[data-testid="last-checked"]'
                        )!;
                        const checkedRect = checked.getBoundingClientRect();
                        const coffee = header.querySelector(
                            '[aria-label="Open Buy Me a Coffee page"]'
                        )!;
                        const titleElement = header.querySelector('h2')!;
                        const logo = header.querySelector('img')!;
                        const logoRect = logo.getBoundingClientRect();
                        const actions = checked.parentElement!;
                        const coffeeCheckedGap =
                            checkedRect.left -
                            coffee.getBoundingClientRect().right;
                        const textRange = document.createRange();
                        textRange.selectNodeContents(checked);
                        return {
                            sameRow: Array.from(
                                header.querySelectorAll(
                                    'button[data-slot="button"], [data-testid="last-checked"]'
                                )
                            ).every((element) => {
                                const rect = element.getBoundingClientRect();
                                return (
                                    Math.abs(
                                        (title.top + title.bottom) / 2 -
                                            (rect.top + rect.bottom) / 2
                                    ) < 2
                                );
                            }),
                            fits: header.scrollWidth <= header.clientWidth,
                            branding:
                                titleElement.textContent?.trim() ===
                                    'PR Tracker' &&
                                logo.src.endsWith('/branding/watchtower.png') &&
                                logo.naturalWidth === 96 &&
                                logo.naturalHeight === 98 &&
                                logo.alt === '' &&
                                logo.getAttribute('aria-hidden') === 'true' &&
                                logoRect.width === 26 &&
                                logoRect.height === 26 &&
                                Math.abs(
                                    (logoRect.top + logoRect.bottom) / 2 -
                                        (title.top + title.bottom) / 2 -
                                        1
                                ) < 0.1 &&
                                title.left - logoRect.right > 0 &&
                                title.left - logoRect.right <= 8 &&
                                header.getBoundingClientRect().height === 28,
                            freshnessReadable:
                                checkedRect.width > 0 &&
                                Array.from(textRange.getClientRects()).every(
                                    (rect) =>
                                        rect.left >= checkedRect.left - 1 &&
                                        rect.right <= checkedRect.right + 1
                                ),
                            adjacent:
                                checked.nextElementSibling?.getAttribute(
                                    'aria-label'
                                ),
                            coffeeBeforeChecked:
                                header
                                    .querySelector(
                                        '[aria-label="Open Buy Me a Coffee page"]'
                                    )!
                                    .getBoundingClientRect().right <=
                                checkedRect.left,
                            grouped:
                                header.children.length === 2 &&
                                titleElement.parentElement?.children.length ===
                                    2 &&
                                titleElement.previousElementSibling === logo &&
                                titleElement.parentElement
                                    ?.nextElementSibling === actions &&
                                actions.firstElementChild === coffee &&
                                coffee.nextElementSibling === checked &&
                                actions.contains(
                                    header.querySelector(
                                        '[aria-label="Settings"]'
                                    )
                                ) &&
                                actions.contains(
                                    header.querySelector(
                                        '[aria-label="Sign Out"]'
                                    )
                                ),
                            coffeeCheckedGap:
                                coffeeCheckedGap > 8 && coffeeCheckedGap <= 12,
                            themeControls: header.querySelectorAll(
                                '[aria-label="Theme selector"]'
                            ).length,
                            switches:
                                header.querySelectorAll('[role="switch"]')
                                    .length,
                        };
                    });
                    expect(layout).toEqual({
                        sameRow: true,
                        fits: true,
                        branding: true,
                        freshnessReadable: true,
                        adjacent: 'Refresh Pull Requests',
                        coffeeBeforeChecked: true,
                        grouped: true,
                        coffeeCheckedGap: true,
                        themeControls: 0,
                        switches: 0,
                    });
                }
            }
            expect(
                await page.$('header [aria-label="Sign Out"]')
            ).not.toBeNull();
            expect(
                await page.$('header [aria-label="Open Buy Me a Coffee page"]')
            ).not.toBeNull();

            await page.focus('[aria-label="Settings"]');
            const focusStyle = await page.$eval(
                '[aria-label="Settings"]',
                (element) => getComputedStyle(element).boxShadow
            );
            expect(focusStyle).not.toBe('none');
            await page.keyboard.press('Enter');
            await page.waitForSelector(
                '[role="dialog"][aria-label="Settings"]'
            );
            expect(
                await page.$eval(
                    '[aria-label="Settings"][aria-haspopup]',
                    (element) => element.getAttribute('aria-expanded')
                )
            ).toBe('true');
            expect(
                await page.evaluate(() =>
                    document.activeElement?.getAttribute('aria-label')
                )
            ).toBe('Theme selector');
            expect(await page.$$('[aria-label="Theme selector"]')).toHaveLength(
                1
            );
            expect(await page.$$('[role="switch"]')).toHaveLength(1);
            await waitForText(page, '[role="dialog"]', 'Theme');
            await waitForText(page, '[role="dialog"]', 'Notifications');
            await waitForText(page, '[role="dialog"]', 'On');
            expect(
                await page.$('[role="dialog"] [data-testid="last-checked"]')
            ).toBeNull();
            await page.keyboard.press('Tab');
            expect(
                await page.evaluate(() =>
                    document.activeElement?.getAttribute('role')
                )
            ).toBe('switch');
            await page.keyboard.press('Space');
            await waitForText(page, '[role="dialog"]', 'Off');
            await expect
                .poll(
                    async () =>
                        (await readAppData(page)).preferences
                            ?.notificationsEnabled
                )
                .toBe(false);
            expect(
                await page.$eval('[role="switch"]', (element) =>
                    element.getAttribute('aria-checked')
                )
            ).toBe('false');
            await page.keyboard.press('Escape');
            await page.waitForSelector('[role="dialog"]', { hidden: true });
            expect(
                await page.evaluate(() =>
                    document.activeElement?.getAttribute('aria-label')
                )
            ).toBe('Settings');
            expect(
                await page.$eval('[aria-label="Settings"]', (element) =>
                    element.getAttribute('aria-expanded')
                )
            ).toBe('false');

            await page.click('[aria-label="Settings"]');
            await page.click('[aria-label="Settings"]');
            expect(await page.$('[role="dialog"]')).toBeNull();
            await page.click('[aria-label="Settings"]');
            await page.click('header h2');
            expect(await page.$('[role="dialog"]')).toBeNull();
            expect(
                await page.$('header [data-testid="last-checked"]')
            ).not.toBeNull();
        }
    );

    it('restores notification, filter, sort, custom-query, and theme choices after reload', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        await page.click('[aria-label="Settings"]');
        await page.click('[aria-label="Disable notifications"]');
        await page.keyboard.press('Escape');
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
        await page.click('[aria-label="Settings"]');
        await page.select('[aria-label="Theme selector"]', 'dark');
        await page.waitForFunction(
            () => document.documentElement.getAttribute('data-theme') === 'dark'
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForDashboard(page);
        await page.click('[aria-label="Settings"]');
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
        await page.click('[aria-label="Settings"]');
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
        await page.click('[aria-label="Settings"]');
        await page.click('[aria-label="Disable notifications"]');
        await page.keyboard.press('Escape');
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
        await reopened.click('[aria-label="Settings"]');
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
