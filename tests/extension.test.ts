import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Page } from 'puppeteer';
import {
    getBrowser,
    getExtensionId,
    openExtensionPopup,
    getExtensionInfo,
    waitForElement,
    debugExtensionTargets,
} from './setup.js';
import dotenv from 'dotenv';
import { validateToken } from './types.js';
import { delay } from './utils.js';

dotenv.config({ path: '.env.test' });

const testToken = validateToken(process.env.GITHUB_TOKEN);

describe('PR Tracker Extension', () => {
    let popupPage: Page;

    it('debug extension loading', async () => {
        const targets = await debugExtensionTargets();
        const extensionId = getExtensionId();
        const info = await getExtensionInfo();

        console.log('Extension ID:', extensionId);
        console.log('Extension Info:', info);
        console.log('Extension targets found:', targets.length);

        expect(extensionId).toBeDefined();
        expect(extensionId.length).toBeGreaterThan(0);
    });

    beforeEach(async () => {
        popupPage = await openExtensionPopup();
    });

    afterEach(async () => {
        if (popupPage && !popupPage.isClosed()) {
            await popupPage.close();
        }
    });

    it('popup loads successfully', async () => {
        await waitForElement(popupPage, 'body');

        const title = await popupPage.title();
        expect(title).toBeTruthy();
    });

    it('Enter GitHub token and save', async () => {
        const tokenInput = await waitForElement(popupPage, '#githubToken');
        expect(tokenInput).toBeDefined();

        await tokenInput?.type(testToken);

        // Wait for submit button to be clickable
        await waitForElement(popupPage, 'button[type="submit"]');

        // Click the submit button
        await popupPage.click('button[type="submit"]');

        const newPasswordInput = await waitForElement(
            popupPage,
            '#newPassword'
        );
        newPasswordInput?.type('12345678');
        //sleep for 1000ms to simulate user typing
        await delay(1000);
        const confirmNewPasswordInput = await waitForElement(
            popupPage,
            '#confirmNewPassword'
        );
        await delay(1000);
        confirmNewPasswordInput?.type('12345678');

        await popupPage.click('button[type="submit"]');

        // Wait for authentication to complete and main screen to load
        await delay(2000);

        // Verify we've reached the authenticated state by checking for main UI elements
        // Look for the PR Tracker header
        const header = await waitForElement(popupPage, 'h2', 10000);
        const headerText = await header?.evaluate((el) => el.textContent);
        expect(headerText).toContain('Pull Requests');

        // Check for the refresh button (indicates we're on the main screen)
        const refreshButton = await waitForElement(
            popupPage,
            'button[aria-label="Refresh Pull Requests"]',
            5000
        );
        expect(refreshButton).toBeDefined();

        // Verify the filter bar is present
        const filterBar = await waitForElement(popupPage, 'div.mb-4', 5000);
        expect(filterBar).toBeDefined();

        // Check that we're no longer on an auth screen
        const authScreens = await popupPage.$$('.screen-auth');
        expect(authScreens.length).toBe(0);

        // Optionally, wait a bit longer for PR data to load and verify PR list container exists
        await delay(2000);
        const prListContainer = await waitForElement(
            popupPage,
            '.container',
            5000
        );
        expect(prListContainer).toBeDefined();

        console.log('✅ Authentication flow completed successfully!');
    });
});
