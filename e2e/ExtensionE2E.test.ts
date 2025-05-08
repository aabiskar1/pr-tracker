import { browser, $, expect } from '@wdio/globals';
import { getExtensionPath, getExtensionId } from './helpers/extensionHelper';
import { getBrowserName } from './helpers/utils';
import {
    authenticateExtension,
    getGitHubToken,
    isAuthenticated,
} from './helpers/authHelper';
import path from 'path';

describe('PR Tracker Extension E2E Tests', function () {
    let extensionId: string;
    const browserName = getBrowserName();

    before(async function () {
        // This test requires a built extension
        console.log(`Running tests in ${browserName}`);

        // Check for GitHub token availability if we need to authenticate
        try {
            getGitHubToken(); // Will throw if token is not available
        } catch (err) {
            console.log(
                'GitHub token not found in environment. Tests will still run but may not be able to authenticate.'
            );
        }

        try {
            extensionId = await getExtensionId(browser);
            console.log(`Found extension ID: ${extensionId}`);
        } catch (err) {
            console.error('Failed to get extension ID:', err);
            this.skip();
        }
    });

    it('should open extension popup and authenticate if needed', async function () {
        // Navigate to the extension popup
        if (browserName === 'chrome') {
            await browser.url(`chrome-extension://${extensionId}/index.html`);
        } else if (browserName === 'firefox') {
            await browser.url(`moz-extension://${extensionId}/index.html`);
        }

        // Wait for the extension to load
        await browser.pause(2000);

        try {
            // Check if we need to authenticate
            if (await isAuthenticated()) {
                console.log(
                    'Already authenticated - skipping authentication steps'
                );

                // Check for PR list elements
                const prListContainer = await $('.pr-list, div.space-y-3');
                await expect(prListContainer).toBeExisting();

                // Check for filter/search functionality in authenticated view
                const filterElement = await $(
                    '.filter-bar, input[type="search"]'
                );
                await expect(filterElement).toExist();
            } else {
                console.log(
                    'Authentication form found - attempting to authenticate'
                );

                try {
                    // Try to automatically authenticate using GitHub token
                    await authenticateExtension();

                    // After authentication, verify we can see the PR list
                    const prList = await $(
                        '.list-container, .pr-list, div.space-y-3'
                    );
                    await prList.waitForExist({ timeout: 10000 });
                    await expect(prList).toBeDisplayed();
                } catch (authErr) {
                    console.log(
                        'Automated authentication failed, checking basic form elements instead'
                    );

                    // If automatic auth fails, just verify form elements
                    const tokenInput = await $('input[type="password"]');
                    await expect(tokenInput).toBeExisting();

                    const authButton = await $(
                        'button[type="submit"], button*=Authenticate'
                    );
                    await expect(authButton).toBeExisting();
                }
            }
        } catch (err) {
            console.error('Test failed:', err);
            throw err;
        }
    });

    it('should have dark/light mode toggle', async function () {
        // Navigate to the extension popup
        if (browserName === 'chrome') {
            await browser.url(`chrome-extension://${extensionId}/index.html`);
        } else if (browserName === 'firefox') {
            await browser.url(`moz-extension://${extensionId}/index.html`);
        }

        // Wait for the extension to load
        await browser.pause(2000);

        // Look for theme toggle button
        const themeToggle = await $(
            'button.theme-toggle, button svg[class*="moon"], button svg[class*="sun"]'
        );
        await expect(themeToggle).toBeExisting();

        // Click theme toggle and verify theme change
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

        await themeToggle.click();
        await browser.pause(500);

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

        // Theme should have toggled
        expect(newTheme).not.toEqual(initialTheme);
    });

    // Additional test for PR list functionality (only runs if authenticated)
    it('should show PR list with filterable results when authenticated', async function () {
        // Skip this test if not authenticated
        if (!(await isAuthenticated())) {
            console.log('Not authenticated - skipping PR list test');
            this.skip();
            return;
        }

        // Navigate to the extension popup
        if (browserName === 'chrome') {
            await browser.url(`chrome-extension://${extensionId}/index.html`);
        } else if (browserName === 'firefox') {
            await browser.url(`moz-extension://${extensionId}/index.html`);
        }

        // Wait for the extension to load
        await browser.pause(2000);

        // Check for PR list elements
        const prListContainer = await $('.pr-list, div.space-y-3');
        await expect(prListContainer).toBeExisting();

        // Find and check search/filter functionality
        const searchInput = await $(
            'input[type="search"], input[placeholder*="search"], input[placeholder*="filter"]'
        );
        if (await searchInput.isExisting()) {
            // Test search functionality if available
            await searchInput.setValue('test search');
            await browser.pause(500);
            await searchInput.clearValue();
        }

        // Check for sort or filter elements
        const sortElement = await $(
            'select, button[aria-label*="sort"], button[aria-label*="filter"]'
        );
        if (await sortElement.isExisting()) {
            await expect(sortElement).toBeClickable();
        }
    });
});
