import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { getBrowser, getExtensionId } from './setup.js';
import {
    clearExtensionState,
    installGitHubApiMock,
    openCleanPopup,
    openSeededPopup,
    readAppData,
    waitForDashboard,
    waitForText,
    writeAppData,
    type GitHubMock,
} from './harness.js';
import { appData, POPULATED_PRS, TEST_PASSWORD } from './fixtures.js';

describe('popup state journeys', () => {
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

    it('renders the loading state before transitioning to login', async () => {
        const controlPage = await openCleanPopup();
        await clearExtensionState(controlPage);
        await controlPage.close();

        const page = await getBrowser().newPage();
        pages.push(page);
        await page.evaluateOnNewDocument(() => {
            (
                window as typeof window & { observedLoading?: boolean }
            ).observedLoading = false;
            new MutationObserver(() => {
                if (
                    document.body?.textContent?.includes(
                        'Loading PR Tracker...'
                    )
                ) {
                    (
                        window as typeof window & { observedLoading?: boolean }
                    ).observedLoading = true;
                }
            }).observe(document, { childList: true, subtree: true });
        });
        await page.goto(`chrome-extension://${getExtensionId()}/popup.html`, {
            waitUntil: 'domcontentloaded',
        });
        await waitForText(page, 'h2', 'GitHub Authentication');

        expect(
            await page.evaluate(
                () =>
                    (window as typeof window & { observedLoading?: boolean })
                        .observedLoading
            )
        ).toBe(true);
    });

    it('renders the explicit empty-data message', async () => {
        github.setScenario({ pullRequests: [] });
        const page = await openSeededPopup(github, { data: appData([]) });
        pages.push(page);

        await waitForText(page, 'p', 'No pull requests found');
        expect(await page.$$('li')).toHaveLength(0);
    });

    it('renders deterministic PR content, statuses, authors, reviewers, and links', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        await waitForText(page, 'li', 'Add new authentication flow');

        const content = await page.$eval('body', (body) => body.textContent);
        expect(content).toContain('auth-service');
        expect(content).toContain('web-dashboard');
        expect(content).toContain('api-gateway');
        expect(content).toContain('ui-library');
        expect(content).toContain('Approved');
        expect(content).toContain('Changes');
        expect(content).toContain('Passing');
        expect(content).toContain('Failing');
        expect(content).toContain('Draft');
        expect(content).toContain('@alice');
        expect(content).toContain('12 reviewers requested');
        expect(content).toContain('...');

        const link = await page.$eval('li a', (anchor) => ({
            href: anchor.getAttribute('href'),
            target: anchor.target,
        }));
        expect(link).toEqual({
            href: POPULATED_PRS[0].html_url,
            target: '_blank',
        });
        expect(await page.$$('li img')).not.toHaveLength(0);
    });

    it('keeps search active after a background refresh storage reload', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        const refreshedPrs = POPULATED_PRS.map((pr, index) =>
            index === 0 ? { ...pr, title: 'Refreshed authentication flow' } : pr
        );

        await page.type(
            '[aria-label="Search Pull Requests"]',
            'authentication'
        );
        await page.waitForFunction(
            () => document.querySelectorAll('li').length === 1
        );
        await waitForText(page, 'li', 'Add new authentication flow');
        expect(await page.$$('li')).toHaveLength(1);

        github.setScenario({ pullRequests: refreshedPrs });
        github.resetRequests();
        await page.evaluate(
            (password) =>
                chrome.runtime.sendMessage({
                    type: 'CHECK_PRS',
                    password,
                    manual: true,
                }),
            TEST_PASSWORD
        );
        await expect
            .poll(() => github.requests)
            .toContain('https://api.github.com/user');
        await waitForText(page, 'li', 'Refreshed authentication flow');

        expect(
            await page.$eval(
                '[aria-label="Search Pull Requests"]',
                (input) => (input as HTMLInputElement).value
            )
        ).toBe('authentication');
        expect(await page.$$('li')).toHaveLength(1);
        await page.close();
        pages.pop();
    });

    it('keeps search active after encrypted app-data changes', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        const updatedPrs = POPULATED_PRS.map((pr, index) =>
            index === 0 ? { ...pr, title: 'Updated authentication flow' } : pr
        );

        await page.type(
            '[aria-label="Search Pull Requests"]',
            'authentication'
        );
        await page.waitForFunction(
            () => document.querySelectorAll('li').length === 1
        );

        await writeAppData(page, appData(updatedPrs));
        await waitForText(page, 'li', 'Updated authentication flow');

        expect(
            await page.$eval(
                '[aria-label="Search Pull Requests"]',
                (input) => (input as HTMLInputElement).value
            )
        ).toBe('authentication');
        expect(await page.$$('li')).toHaveLength(1);
        await page.close();
        pages.pop();
    });

    it('combines active search with sort and filter changes', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);

        await page.type('[aria-label="Search Pull Requests"]', 'add');
        await page.waitForFunction(
            () => document.querySelectorAll('li').length === 2
        );

        await page.select('[aria-label="Sort pull requests"]', 'oldest');
        await page.waitForFunction(
            () =>
                document.querySelectorAll('li').length !== 2 ||
                document
                    .querySelector('li h3')
                    ?.textContent?.includes('dark mode') === true
        );
        expect(await page.$$('li')).toHaveLength(2);

        await page.click('[aria-label="Show Drafts"]');
        await page.waitForFunction(
            () => document.querySelectorAll('li').length === 1
        );
        await waitForText(page, 'li', 'Add new authentication flow');
        expect(
            await page.$eval(
                '[aria-label="Search Pull Requests"]',
                (input) => (input as HTMLInputElement).value
            )
        ).toBe('add');
        await page.close();
        pages.pop();
    });

    it('shows a controlled background API error in the dashboard', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        const cachedData = await readAppData(page);
        github.setScenario({ pullRequests: [], searchStatus: 503 });
        github.resetRequests();
        await page.click('[aria-label="Refresh Pull Requests"]');
        await waitForText(
            page,
            '[role="alert"]',
            'GitHub servers are experiencing issues (503)'
        );
        await waitForDashboard(page);
        expect(await page.$$('li')).toHaveLength(POPULATED_PRS.length);
        const dataAfterFailure = await readAppData(page);
        expect(dataAfterFailure).toEqual(cachedData);
        expect(github.requests).toContain('https://api.github.com/user');
        expect(
            github.requests.some((url) => url.includes('/search/issues'))
        ).toBe(true);
    });
});
