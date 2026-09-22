import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { openExtensionPopup } from './setup.js';

describe('test-only popup redesign prototype', () => {
    let page: Page | undefined;

    afterEach(async () => {
        await page?.close();
    });

    const openPrototype = async (query = '') => {
        page = await openExtensionPopup();
        await page.setViewport({ width: 720, height: 600 });
        await page.goto(`${page.url()}?popup-prototype=1${query}`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForSelector('[data-testid="popup-prototype"]');
        return page;
    };

    it('captures light, dark, and expanded-filter designs at popup dimensions', async () => {
        const screenshotDir = path.resolve('screenshots/prototype');
        const capture = async (current: Page, name: string) => {
            if (process.env.CI !== 'true') return;
            fs.mkdirSync(screenshotDir, { recursive: true });
            await current.screenshot({ path: path.join(screenshotDir, name) });
        };
        for (const theme of ['light', 'dark'] as const) {
            const current = await openPrototype(`&theme=${theme}`);
            const metrics = await current.evaluate(() => ({
                theme: document.documentElement.dataset.theme,
                width: document
                    .querySelector('[data-testid="popup-prototype"]')
                    ?.getBoundingClientRect().width,
                height: document
                    .querySelector('[data-testid="popup-prototype"]')
                    ?.getBoundingClientRect().height,
                overflow:
                    document.documentElement.scrollWidth >
                    document.documentElement.clientWidth,
                background: getComputedStyle(
                    document.querySelector('[data-testid="popup-prototype"]')!
                ).backgroundColor,
            }));
            expect(metrics.theme).toBe(theme);
            expect(metrics.width).toBeGreaterThanOrEqual(640);
            expect(metrics.width).toBeLessThanOrEqual(720);
            expect(metrics.height).toBe(600);
            expect(metrics.overflow).toBe(false);
            await capture(current, `popup-${theme}.png`);
            await current.close();
        }
        page = await openPrototype('&theme=dark&filters=1');
        expect(await page.$('[aria-label="Advanced filters"]')).not.toBeNull();
        await capture(page, 'popup-dark-filters.png');

        await page.click('.proto-filter-button');
        const viewportInset =
            720 -
            (await page.$eval(
                '[data-testid="popup-prototype"]',
                (element) => element.getBoundingClientRect().width
            ));
        await page.setViewport({ width: 640 + viewportInset, height: 600 });
        const compact = await page.evaluate(() => ({
            width: document
                .querySelector('[data-testid="popup-prototype"]')
                ?.getBoundingClientRect().width,
            overflow:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
        }));
        expect(compact).toEqual({ width: 640, overflow: false });
        await capture(page, 'popup-dark-compact.png');

        await page.setViewport({ width: 720, height: 600 });
        const baseUrl = page.url().split('?')[0];
        for (const state of ['loading', 'empty']) {
            await page.goto(
                `${baseUrl}?popup-prototype=1&theme=dark&state=${state}`
            );
            await page.waitForSelector(
                state === 'loading' ? '.proto-loading' : '.proto-empty'
            );
            await capture(page, `popup-dark-${state}.png`);
        }
    });

    it('supports navigation, search shortcut, filters, and empty/loading fixtures', async () => {
        page = await openPrototype('&theme=dark');
        expect(await page.$$('li.proto-row')).toHaveLength(5);
        await page.keyboard.press('/');
        expect(
            await page.evaluate(() =>
                document.activeElement?.getAttribute('aria-label')
            )
        ).toBe('Search pull requests');
        await page.keyboard.type('checkout');
        expect(await page.$$('li.proto-row')).toHaveLength(1);
        await page.click('button[aria-label="Clear search"]');
        await page.click('.proto-tab:nth-child(2)');
        expect(await page.$$('li.proto-row')).toHaveLength(3);
        await page.click('.proto-filter-button');
        expect(await page.$('[aria-label="Advanced filters"]')).not.toBeNull();
        await page.select('select:has(option[value="failing"])', 'failing');
        expect(await page.$$('li.proto-row')).toHaveLength(1);

        await page.goto(
            `${page.url().split('?')[0]}?popup-prototype=1&state=loading`
        );
        await page.waitForSelector('[aria-label="Loading pull requests"]');
        await page.goto(
            `${page.url().split('?')[0]}?popup-prototype=1&state=empty`
        );
        await page.waitForSelector('.proto-empty');
    });
});
