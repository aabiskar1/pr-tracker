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

                // Wait for the extension to finish any async storage after password setup
                await browser.pause(1000);

                // Inject fake PR data into browser storage and trigger UI update
                await browser.executeAsync(
                    (prs, done) => {
                        // Use window.chrome or window.browser for cross-browser compatibility
                        const storage =
                            window.chrome &&
                            window.chrome.storage &&
                            window.chrome.storage.local
                                ? window.chrome.storage.local
                                : window.browser &&
                                    window.browser.storage &&
                                    window.browser.storage.local
                                  ? window.browser.storage.local
                                  : null;
                        if (!storage) return done('No storage API found');
                        storage.set({ pullRequests: prs }, () => {
                            // Dispatch a storage event to notify React UI (simulate real extension behavior)
                            window.dispatchEvent(new Event('storage'));
                            done();
                        });
                    },
                    [
                        {
                            id: 1,
                            title: 'Add new authentication flow',
                            html_url:
                                'https://github.com/acme/auth-service/pull/1',
                            repository: { name: 'auth-service' },
                            state: 'open',
                            draft: false,
                            created_at: new Date(
                                Date.now() - 2 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            requested_reviewers: [
                                {
                                    login: 'alice',
                                    avatar_url:
                                        'https://avatars.githubusercontent.com/u/1?v=4',
                                },
                            ],
                            review_status: 'pending',
                            ci_status: 'passing',
                        },
                        {
                            id: 2,
                            title: 'Fix bug in dashboard',
                            html_url:
                                'https://github.com/acme/web-dashboard/pull/2',
                            repository: { name: 'web-dashboard' },
                            state: 'open',
                            draft: true,
                            created_at: new Date(
                                Date.now() - 5 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            requested_reviewers: [],
                            review_status: 'approved',
                            ci_status: 'failing',
                        },
                        {
                            id: 3,
                            title: 'Refactor API layer',
                            html_url:
                                'https://github.com/acme/api-gateway/pull/3',
                            repository: { name: 'api-gateway' },
                            state: 'open',
                            draft: false,
                            created_at: new Date(
                                Date.now() - 1 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            requested_reviewers: [
                                {
                                    login: 'bob',
                                    avatar_url:
                                        'https://avatars.githubusercontent.com/u/2?v=4',
                                },
                                {
                                    login: 'carol',
                                    avatar_url:
                                        'https://avatars.githubusercontent.com/u/3?v=4',
                                },
                            ],
                            review_status: 'changes-requested',
                            ci_status: 'pending',
                        },
                        {
                            id: 4,
                            title: 'Update README and docs',
                            html_url: 'https://github.com/acme/docs/pull/4',
                            repository: { name: 'docs' },
                            state: 'open',
                            draft: false,
                            created_at: new Date(
                                Date.now() - 10 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            requested_reviewers: [],
                            review_status: 'approved',
                            ci_status: 'passing',
                        },
                        {
                            id: 5,
                            title: 'WIP: Add dark mode support',
                            html_url:
                                'https://github.com/acme/ui-library/pull/5',
                            repository: { name: 'ui-library' },
                            state: 'open',
                            draft: true,
                            created_at: new Date(
                                Date.now() - 3 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            requested_reviewers: [
                                {
                                    login: 'dave',
                                    avatar_url:
                                        'https://avatars.githubusercontent.com/u/4?v=4',
                                },
                            ],
                            review_status: 'pending',
                            ci_status: 'pending',
                        },
                        {
                            id: 6,
                            title: 'Hotfix: Security patch',
                            html_url:
                                'https://github.com/acme/auth-service/pull/6',
                            repository: { name: 'auth-service' },
                            state: 'open',
                            draft: false,
                            created_at: new Date(
                                Date.now() - 0.5 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            requested_reviewers: [
                                {
                                    login: 'eve',
                                    avatar_url:
                                        'https://avatars.githubusercontent.com/u/5?v=4',
                                },
                            ],
                            review_status: 'approved',
                            ci_status: 'passing',
                        },
                        {
                            id: 7,
                            title: 'Remove deprecated endpoints',
                            html_url:
                                'https://github.com/acme/api-gateway/pull/7',
                            repository: { name: 'api-gateway' },
                            state: 'open',
                            draft: false,
                            created_at: new Date(
                                Date.now() - 15 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            requested_reviewers: [],
                            review_status: 'changes-requested',
                            ci_status: 'failing',
                        },
                    ]
                );

                // Wait for the UI to update with the fake PRs
                await browser.pause(1000);

                // Now check that some of the fake PRs are shown in the UI
                const prTitle1 = await $('*=Add new authentication flow');
                await expect(prTitle1).toBeExisting();
                const prTitle2 = await $('*=Fix bug in dashboard');
                await expect(prTitle2).toBeExisting();
                const prTitle3 = await $('*=Refactor API layer');
                await expect(prTitle3).toBeExisting();
            }
        } catch (err) {
            console.error('Test failed:', err);
            throw err;
        }
    });
});
