import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { openExtensionPopup } from './setup.js';

describe('development design-system showcase', () => {
    let page: Page | undefined;

    afterEach(async () => {
        await page?.close();
    });

    it('renders both themes and supports keyboard focus and activation', async () => {
        page = await openExtensionPopup();
        await page.goto(`${page.url()}?design-system-showcase=1`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForSelector('[data-testid="design-system-showcase"]');

        const themes = await page.$$eval('[data-showcase-theme]', (elements) =>
            elements.map((element) => ({
                theme: element.getAttribute('data-showcase-theme'),
                background: getComputedStyle(element).backgroundColor,
                color: getComputedStyle(element).color,
            }))
        );
        expect(themes.map(({ theme }) => theme)).toEqual(['light', 'dark']);
        expect(themes[0].background).not.toBe(themes[1].background);
        expect(themes[0].color).not.toBe(themes[1].color);

        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
            const element = document.activeElement as HTMLElement;
            return {
                action: element.dataset.showcaseAction,
                ring: getComputedStyle(element).boxShadow,
            };
        });
        expect(focused.action).toBe('primary');
        expect(focused.ring).not.toBe('none');

        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () =>
                document.querySelector('[data-showcase-activations]')
                    ?.textContent === 'Activations: 1'
        );

        expect(
            await page.$eval(
                'button[aria-label="Search pull requests"]',
                (button) => button.getAttribute('data-slot')
            )
        ).toBe('button');
        expect(
            await page.$eval('button:disabled', (button) =>
                button.hasAttribute('disabled')
            )
        ).toBe(true);
        expect(
            await page.$eval('input[aria-invalid="true"]', (input) =>
                input.getAttribute('aria-describedby')
            )
        ).toBe('demo-error-message');
    });
});
