import { browser, $ } from '@wdio/globals';
import path from 'path';

describe('PR Tracker Extension Tests', () => {
    it('should load extension in Chrome and show popup', async function () {
        // Skip this test if not running in Chrome
        if (browser.capabilities.browserName !== 'chrome') {
            this.skip();
            return;
        }

        // Extension popup URL format for Chrome
        await browser.url('chrome-extension://extension-id/index.html');

        // Wait for the extension popup to load
        const titleElement = await $('h1*=PR Tracker');
        await titleElement.waitForExist({ timeout: 10000 });

        // Verify basic extension UI elements
        await expect(titleElement).toBePresent();

        // Look for the GitHub authentication form or PR list
        const authForm = await $('form');
        const prList = await $('.pr-list');

        await expect(
            (await authForm.isExisting()) || (await prList.isExisting())
        ).toBe(true);
    });

    it('should load extension in Firefox and show popup', async function () {
        // Skip this test if not running in Firefox
        if (browser.capabilities.browserName !== 'firefox') {
            this.skip();
            return;
        }

        // Extension popup URL format for Firefox - using moz-extension protocol
        await browser.url('moz-extension://extension-id/index.html');

        // Wait for the extension popup to load
        const titleElement = await $('h1*=PR Tracker');
        await titleElement.waitForExist({ timeout: 10000 });

        // Verify basic extension UI elements
        await expect(titleElement).toBePresent();

        // Look for the GitHub authentication form or PR list
        const authForm = await $('form');
        const prList = await $('.pr-list');

        await expect(
            (await authForm.isExisting()) || (await prList.isExisting())
        ).toBe(true);
    });
});
