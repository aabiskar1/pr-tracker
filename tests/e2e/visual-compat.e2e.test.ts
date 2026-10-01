import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import {
    installGitHubApiMock,
    openCleanPopup,
    openSeededPopup,
    waitForText,
    type GitHubMock,
} from './harness.js';
import { POPULATED_PRS } from './fixtures.js';
import { getBrowser, getExtensionId } from './setup.js';

const captureDir = path.resolve('screenshots/visual-compat');
const reference = process.env.VISUAL_REF;

async function capture(page: Page, name: string) {
    if (!reference) return;
    fs.mkdirSync(captureDir, { recursive: true });
    await page.screenshot({
        path: path.join(captureDir, `${reference}-${name}.png`),
        fullPage: true,
    });
}

describe('original popup visual compatibility', () => {
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

    it.each(['light', 'dark'] as const)(
        'captures the same dashboard, error, and auth states in %s',
        async (theme) => {
            github.setScenario({ pullRequests: POPULATED_PRS });
            const page = await openSeededPopup(github, { theme });
            pages.push(page);
            await page.emulateMediaFeatures([
                { name: 'prefers-reduced-motion', value: 'reduce' },
            ]);
            await page.setViewport({
                width: 750,
                height: 600,
                deviceScaleFactor: 1,
            });
            await page.evaluate(() => document.fonts.ready);

            const metrics = await page.evaluate(() => {
                const inspect = (selector: string) => {
                    const element = document.querySelector(selector);
                    if (!element) throw new Error(`Missing ${selector}`);
                    const computed = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return {
                        background: computed.backgroundColor,
                        foreground: computed.color,
                        border: computed.borderTopColor,
                        borderLeft: computed.borderLeftColor,
                        fontSize: computed.fontSize,
                        lineHeight: computed.lineHeight,
                        padding: computed.padding,
                        height: Math.round(rect.height),
                        width: Math.round(rect.width),
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                    };
                };
                const search = 'input[aria-label="Search Pull Requests"]';
                const custom = 'input[aria-label="Custom GitHub search query"]';
                const placeholder = (selector: string) =>
                    getComputedStyle(
                        document.querySelector(selector)!,
                        '::placeholder'
                    ).color;
                return {
                    theme: document.documentElement.getAttribute('data-theme'),
                    viewport: [window.innerWidth, window.innerHeight],
                    scrollWidth: document.documentElement.scrollWidth,
                    header: inspect('h2'),
                    dashboard: inspect('.screen-prlist'),
                    filter: inspect('.filter-bar-container'),
                    filterRows: Array.from(
                        document.querySelector('.filter-bar-container')!
                            .children
                    ).map((element) => ({
                        y: Math.round(element.getBoundingClientRect().y),
                        height: Math.round(
                            element.getBoundingClientRect().height
                        ),
                    })),
                    ageSelect: inspect('select[name="pr-age-filter"]'),
                    sortSelect: inspect('select[name="sort-pull-requests"]'),
                    resetFilters: inspect(
                        '.filter-bar-container button:not([aria-label])'
                    ),
                    filterBadge: inspect(
                        'label[title="Show passing checks"] > div, label[title="Show passing checks"] [data-slot="badge"]'
                    ),
                    search: {
                        ...inspect(search),
                        placeholder: placeholder(search),
                    },
                    customQuery: {
                        ...inspect(custom),
                        placeholder: placeholder(custom),
                    },
                    card: inspect('li'),
                    title: inspect('li h3'),
                    age: inspect('li div.flex.items-center.gap-1.text-xs'),
                    refresh: inspect(
                        'button[aria-label="Refresh Pull Requests"]'
                    ),
                    signOut: inspect('button[aria-label="Sign Out"]'),
                    notificationTrack: inspect(
                        '.theme-toggle-switch .toggle-track'
                    ),
                };
            });
            expect(metrics.theme).toBe(theme);
            expect(metrics.scrollWidth).toBeLessThanOrEqual(
                metrics.viewport[0]
            );
            expect(metrics.filter.width).toBe(metrics.search.width);
            expect(metrics.card.width).toBe(metrics.search.width);
            expect(metrics.filter.x).toBe(metrics.search.x);
            expect(metrics.card.x).toBe(metrics.search.x);
            expect(metrics.filter.height).toBeGreaterThanOrEqual(104);
            expect(metrics.filter.height).toBeLessThanOrEqual(106);
            expect(metrics.search.height).toBe(40);
            expect(metrics.customQuery.height).toBe(29);
            expect(metrics.card.borderLeft).toBe(metrics.card.border);
            if (reference) {
                fs.mkdirSync(captureDir, { recursive: true });
                fs.writeFileSync(
                    path.join(captureDir, `${reference}-${theme}.json`),
                    JSON.stringify(metrics, null, 2)
                );
            }
            await capture(page, `${theme}-dashboard`);

            github.setScenario({ pullRequests: [], searchStatus: 503 });
            await page.click('[aria-label="Refresh Pull Requests"]');
            await waitForText(
                page,
                '[role="alert"]',
                'GitHub servers are experiencing issues (503)'
            );
            const errorColours = await page.$eval(
                '[role="alert"]',
                (element) => ({
                    background: getComputedStyle(element).backgroundColor,
                    foreground: getComputedStyle(element).color,
                })
            );
            expect(errorColours).toEqual(
                theme === 'dark'
                    ? {
                          background: 'rgb(127, 29, 29)',
                          foreground: 'rgb(230, 237, 243)',
                      }
                    : {
                          background: 'rgb(254, 226, 226)',
                          foreground: 'rgb(185, 28, 28)',
                      }
            );
            await capture(page, `${theme}-error`);

            await page.close();
            pages.pop();
            const authPage = await openCleanPopup();
            pages.push(authPage);
            await authPage.emulateMediaFeatures([
                { name: 'prefers-reduced-motion', value: 'reduce' },
            ]);
            await authPage.setViewport({
                width: 750,
                height: 600,
                deviceScaleFactor: 1,
            });
            await authPage.evaluate(async (chosenTheme) => {
                await chrome.storage.local.set({
                    'theme-preference': chosenTheme,
                });
            }, theme);
            await authPage.reload({ waitUntil: 'domcontentloaded' });
            await waitForText(authPage, 'h2', 'GitHub Authentication');
            expect(
                await authPage.evaluate(
                    () => document.documentElement.dataset.theme
                )
            ).toBe(theme);
            const authStyles = await authPage.evaluate(() => {
                const input = document.querySelector(
                    'input[aria-label="GitHub personal access token"]'
                )!;
                const submit = document.querySelector(
                    'button[aria-label="Save Token"]'
                )!;
                return {
                    inputBackground: getComputedStyle(input).backgroundColor,
                    inputHeight: Math.round(
                        input.getBoundingClientRect().height
                    ),
                    buttonBackground: getComputedStyle(submit).backgroundColor,
                    buttonHeight: Math.round(
                        submit.getBoundingClientRect().height
                    ),
                };
            });
            expect(authStyles).toEqual(
                theme === 'dark'
                    ? {
                          inputBackground: 'rgb(34, 39, 46)',
                          inputHeight: 31,
                          buttonBackground: 'rgb(35, 134, 54)',
                          buttonHeight: 34,
                      }
                    : {
                          inputBackground: 'rgb(255, 255, 255)',
                          inputHeight: 31,
                          buttonBackground: 'rgb(80, 70, 228)',
                          buttonHeight: 34,
                      }
            );
            await capture(authPage, `${theme}-auth`);
        }
    );

    it.each(['light', 'dark'] as const)(
        'captures the original loading treatment in %s',
        async (theme) => {
            const control = await openCleanPopup();
            await control.evaluate(
                async (chosenTheme) =>
                    chrome.storage.local.set({
                        'theme-preference': chosenTheme,
                    }),
                theme
            );
            await control.close();

            const page = await getBrowser().newPage();
            pages.push(page);
            await page.setViewport({
                width: 750,
                height: 600,
                deviceScaleFactor: 1,
            });
            await page.emulateMediaFeatures([
                { name: 'prefers-reduced-motion', value: 'reduce' },
            ]);
            await page.evaluateOnNewDocument(() => {
                const send = chrome.runtime.sendMessage.bind(chrome.runtime);
                Object.defineProperty(chrome.runtime, 'sendMessage', {
                    configurable: true,
                    value: (...args: unknown[]) => {
                        if (
                            (args[0] as { type?: string })?.type ===
                            'GET_REMEMBERED_PASSWORD'
                        ) {
                            return new Promise(() => undefined);
                        }
                        return send(...(args as Parameters<typeof send>));
                    },
                });
            });
            await page.goto(
                `chrome-extension://${getExtensionId()}/popup.html`,
                {
                    waitUntil: 'domcontentloaded',
                }
            );
            await waitForText(page, 'p', 'Loading PR Tracker...');
            await page.waitForFunction(
                () => document.documentElement.dataset.screen === 'loading'
            );
            expect(
                await page.evaluate(
                    () => document.documentElement.dataset.theme
                )
            ).toBe(theme);
            await capture(page, `${theme}-loading`);
        }
    );
});
