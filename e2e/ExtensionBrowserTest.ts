/**
 * Browser Extension Tests
 *
 * This file contains tests specifically for loading and testing the browser extension
 * in both Chrome and Firefox environments.
 */

import { browser, $, expect } from '@wdio/globals';
import { getExtensionPath, getExtensionId } from './helpers/extensionHelper';
import { getBrowserName } from './helpers/utils';
import {
    authenticateExtension,
    getGitHubToken,
    isAuthenticated,
} from './helpers/authHelper';

describe('PR Tracker Extension Browser Tests', function () {
    let extensionId: string;
    const browserName = getBrowserName();

    before(async function () {
        // Skip tests if not running in an actual browser environment
        if (!process.env.TEST_TYPE || process.env.TEST_TYPE !== 'extension') {
            console.log(
                'Skipping extension tests - not in extension test mode'
            );
            this.skip();
            return;
        }

        // Check for GitHub token in environment
        try {
            getGitHubToken(); // This will throw if token is missing
        } catch (err) {
            console.error(`GitHub token missing in .env.test file: ${err}`);
            this.skip();
            return;
        }

        // Get the extension ID using the WebDriverIO command
        try {
            // Using getExtensionId from our helper instead of browser.getExtensionId
            extensionId = await getExtensionId(browser);
            console.log(`Found ${browserName} extension ID: ${extensionId}`);
        } catch (err) {
            console.error(`Failed to get extension ID: ${err}`);
            this.skip();
        }
    });

    it('should load the extension popup and authenticate', async function () {
        // Navigate to the extension popup using the appropriate protocol
        if (browserName === 'chrome') {
            await browser.url(`chrome-extension://${extensionId}/index.html`);
        } else if (browserName === 'firefox') {
            await browser.url(`moz-extension://${extensionId}/index.html`);
        } else {
            throw new Error(`Unsupported browser: ${browserName}`);
        }

        // Wait for the extension UI to load
        await browser.pause(1000);

        // Check for the extension title
        const titleElement = await $('h1');
        await titleElement.waitForExist({ timeout: 5000 });
        await expect(titleElement).toBeDisplayed();

        // Check if already authenticated
        if (!(await isAuthenticated())) {
            console.log('Not authenticated - performing authentication steps');
            await authenticateExtension();
        } else {
            console.log('Already authenticated - skipping authentication');
        }

        // After authentication, verify we can see the PR list
        const prList = await $('.list-container, .pr-list, div.space-y-3');
        await prList.waitForExist({ timeout: 10000 });
        await expect(prList).toBeDisplayed();

        // Check for filter or search functionality
        const filterElement = await $('.filter-bar, input[type="search"]');
        await expect(filterElement).toExist();
    });

    it('should have a theme toggle button and be able to switch themes', async function () {
        // Look for theme toggle button
        const themeToggle = await $(
            '.theme-toggle, button:has(.theme-icon), button[aria-label*="theme"]'
        );
        await expect(themeToggle).toBeExisting();

        // Theme toggle should be clickable
        await expect(themeToggle).toBeClickable();

        // Click the theme toggle and verify it changes
        const initialTheme = await browser.execute(() => {
            // Check for theme in different possible locations
            const docTheme =
                document.documentElement.getAttribute('data-theme');
            const bodyTheme = document.body.getAttribute('data-theme');
            const isDarkClass =
                document.documentElement.classList.contains('dark');
            const storedTheme = localStorage.getItem('theme');

            if (docTheme) return docTheme;
            if (bodyTheme) return bodyTheme;
            if (isDarkClass) return 'dark';
            if (storedTheme) return storedTheme;
            return 'light';
        });

        console.log(`Initial theme: ${initialTheme}`);

        // Click the theme toggle button
        await themeToggle.click();
        await browser.pause(500);

        // Get the new theme
        const newTheme = await browser.execute(() => {
            // Check for theme in different possible locations
            const docTheme =
                document.documentElement.getAttribute('data-theme');
            const bodyTheme = document.body.getAttribute('data-theme');
            const isDarkClass =
                document.documentElement.classList.contains('dark');
            const storedTheme = localStorage.getItem('theme');

            if (docTheme) return docTheme;
            if (bodyTheme) return bodyTheme;
            if (isDarkClass) return 'dark';
            if (storedTheme) return storedTheme;
            return 'light';
        });

        console.log(`New theme after toggle: ${newTheme}`);

        // Theme should have changed
        await expect(initialTheme !== newTheme).toBe(
            true,
            'Theme did not change after toggle'
        );
    });

    it('should have a working extension icon in the browser toolbar', async function () {
        // This test is harder to automate as it requires clicking on browser UI elements
        // outside the page context, but we can at least verify the extension is installed

        if (browserName === 'chrome') {
            await browser.url('chrome://extensions');

            // Wait for extensions page to load
            await browser.pause(1000);

            // Check for extension in list
            const extensionInstalled = await browser.execute(() => {
                const extensionItems =
                    document.querySelectorAll('extensions-item');
                for (const item of extensionItems) {
                    const name = item.querySelector('#name')?.textContent;
                    if (name && name.includes('PR Tracker')) {
                        return true;
                    }
                }
                return false;
            });

            await expect(extensionInstalled).toBe(
                true,
                'Extension not found in Chrome extensions list'
            );
        } else if (browserName === 'firefox') {
            await browser.url('about:addons');

            // Wait for add-ons page to load
            await browser.pause(1000);

            // Check if our extension is in the list
            const extensionInstalled = await browser.execute(() => {
                const extensionItems = document.querySelectorAll('.addon-card');
                for (const item of extensionItems) {
                    const name = item.querySelector('.addon-name')?.textContent;
                    if (name && name.includes('PR Tracker')) {
                        return true;
                    }
                }
                return false;
            });

            await expect(extensionInstalled).toBe(
                true,
                'Extension not found in Firefox add-ons list'
            );
        }
    });
});
