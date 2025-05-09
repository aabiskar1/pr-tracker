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
    const browserName = 'chrome';

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
        await browser.url(`chrome-extension://${extensionId}/index.html`);

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

                // Find the input with placeholder containing 'ghp_'
                const tokenInput = await $('input[placeholder*="ghp_"]');
                await tokenInput.waitForExist({ timeout: 5000 });
                await expect(tokenInput).toBeExisting();

                // Fill the token from .env.test
                const token = getGitHubToken();
                await tokenInput.setValue(token);

                // Find and click the Next button after entering the token
                const nextButton = await $('button*=Next');
                await expect(nextButton).toBeExisting();
                await nextButton.click();

                // Wait for 10 seconds after clicking Next
                await browser.pause(2000); // Wait for password UI to appear

                // Fill in password and confirm password fields
                const password = '12345678';
                const passwordInput = await $(
                    'input#password, input[placeholder="Enter password"]'
                );
                const confirmPasswordInput = await $(
                    'input#confirmPassword, input[placeholder="Confirm password"]'
                );
                await passwordInput.waitForExist({ timeout: 5000 });
                await confirmPasswordInput.waitForExist({ timeout: 5000 });
                await passwordInput.setValue(password);
                await confirmPasswordInput.setValue(password);

                // Click the Create Password & Encrypt Token button
                const createPasswordButton = await $('button*=Create Password');
                await expect(createPasswordButton).toBeExisting();
                await createPasswordButton.click();

                // Wait for PR list to appear after password setup
                const prList = await $(
                    '.list-container, .pr-list, div.space-y-3'
                );
                await prList.waitForExist({ timeout: 10000 });
                await expect(prList).toBeDisplayed();
            }
        } catch (err) {
            console.error('Test failed:', err);
            throw err;
        }
    });
});
