import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { getBrowser, getExtensionId } from '../setup.js';
import {
    clearExtensionState,
    installGitHubApiMock,
    openCleanPopup,
    openSeededPopup,
    resetManualRefreshThrottle,
    waitForDashboard,
    waitForText,
    type GitHubMock,
} from './harness.js';
import { appData, POPULATED_PRS } from './fixtures.js';

describe('popup state journeys', () => {
    let github: GitHubMock;
    const pages: Page[] = [];

    beforeAll(async () => {
        github = await installGitHubApiMock();
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

    it('filters by search text with a feature-specific result', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);

        await page.type(
            '[aria-label="Search Pull Requests"]',
            'authentication'
        );
        await page.waitForFunction(
            () => document.querySelectorAll('li').length === 1
        );
        await waitForText(page, 'li', 'Add new authentication flow');
        expect(await page.$$('li')).toHaveLength(1);
    });

    it('shows a controlled background API error in the dashboard', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        github.setScenario({ pullRequests: [], userStatus: 503 });
        github.resetRequests();
        await resetManualRefreshThrottle();

        await page.click('[aria-label="Refresh Pull Requests"]');
        await waitForText(
            page,
            '[role="alert"]',
            'GitHub servers are experiencing issues (503)'
        );
        await waitForDashboard(page);
        expect(github.requests).toContain('https://api.github.com/user');
    });
});
