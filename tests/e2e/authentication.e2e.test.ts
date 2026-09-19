import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import {
    clearExtensionState,
    installGitHubApiMock,
    mockTokenValidation,
    openCleanPopup,
    openSeededPopup,
    seedEncryptedState,
    waitForDashboard,
    waitForText,
    type GitHubMock,
} from './harness.js';
import { POPULATED_PRS, TEST_PASSWORD, TEST_TOKEN } from './fixtures.js';

describe('authentication journeys', () => {
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

    it('shows the initial login-needed state without credentials', async () => {
        const page = await openCleanPopup();
        pages.push(page);

        await expect(
            page.$eval('h2', (element) => element.textContent)
        ).resolves.toContain('GitHub Authentication');
        await expect(page.$('#githubToken')).resolves.not.toBeNull();
    });

    it('progresses from a scoped token through password setup to the dashboard', async () => {
        const page = await openCleanPopup();
        pages.push(page);
        const stopMock = await mockTokenValidation(page);

        await page.type('#githubToken', TEST_TOKEN);
        await page.click('[aria-label="Save Token"]');
        await waitForText(page, 'h2', 'Create a Password');
        await page.type('#newPassword', TEST_PASSWORD);
        await page.type('#confirmNewPassword', TEST_PASSWORD);
        await page.click('#rememberPassword');
        await page.click('[aria-label="Create Password"]');
        await waitForDashboard(page);

        const session = await page.evaluate(() =>
            chrome.storage.session.get([
                'sessionPassword',
                'rememberPasswordFlag',
            ])
        );
        expect(session).toEqual({
            sessionPassword: TEST_PASSWORD,
            rememberPasswordFlag: true,
        });
        await stopMock();
    });

    it('rejects a token without the required repo scope', async () => {
        const page = await openCleanPopup();
        pages.push(page);
        const stopMock = await mockTokenValidation(page, {
            scopes: 'read:user',
        });

        await page.type('#githubToken', TEST_TOKEN);
        await page.click('[aria-label="Save Token"]');
        await waitForText(page, '[role="alert"]', 'Token needs "repo" scope');
        expect(await page.$('#newPassword')).toBeNull();
        await stopMock();
    });

    it('shows an invalid-token error without leaving the login screen', async () => {
        const page = await openCleanPopup();
        pages.push(page);
        const stopMock = await mockTokenValidation(page, { status: 401 });

        await page.type('#githubToken', 'invalid-fixture-token');
        await page.click('[aria-label="Save Token"]');
        await waitForText(page, '[role="alert"]', 'Invalid GitHub token');
        expect(await page.$('#githubToken')).not.toBeNull();
        await stopMock();
    });

    it('shows a rate-limit error without leaving the login screen', async () => {
        const page = await openCleanPopup();
        pages.push(page);
        const stopMock = await mockTokenValidation(page, {
            status: 429,
            headers: { 'retry-after': '90' },
            body: {
                message: 'You have exceeded a secondary rate limit.',
            },
        });

        await page.type('#githubToken', TEST_TOKEN);
        await page.click('[aria-label="Save Token"]');
        await waitForText(page, '[role="alert"]', 'rate limiting requests');
        expect(await page.$('#githubToken')).not.toBeNull();
        expect(await page.$('#newPassword')).toBeNull();
        await expect(
            page.$eval(
                '#githubToken',
                (input) => (input as HTMLInputElement).value
            )
        ).resolves.toBe(TEST_TOKEN);
        await stopMock();
    });

    it('requires and validates the password for an existing encrypted token', async () => {
        const page = await openCleanPopup();
        pages.push(page);
        await seedEncryptedState(page, { remember: false });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForText(page, 'h2', 'Enter Password');

        await page.type('#currentPassword', 'incorrect-password');
        await page.click('[aria-label="Sign In"]');
        await waitForText(page, '[role="alert"]', 'Incorrect password');

        await page.$eval('#currentPassword', (input) => {
            (input as HTMLInputElement).value = '';
        });
        await page.type('#currentPassword', TEST_PASSWORD);
        await page.click('[aria-label="Sign In"]');
        await waitForDashboard(page);
        expect(github.requests).toContain('https://api.github.com/user');
    });

    it('restores a remembered encrypted session directly to the dashboard', async () => {
        const page = await openSeededPopup(github, {
            data: {
                pullRequests: POPULATED_PRS,
                oldPullRequests: POPULATED_PRS,
                lastUpdated: '2026-01-15T12:00:00.000Z',
            },
        });
        pages.push(page);

        await waitForDashboard(page);
        expect(await page.$('#currentPassword')).toBeNull();
        await clearExtensionState(page);
    });
});
