import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import {
    installGitHubApiMock,
    openSeededPopup,
    readAppData,
    resetManualRefreshThrottle,
    waitForDashboard,
    waitForText,
    type GitHubMock,
} from './harness.js';
import { appData, POPULATED_PRS, REFRESHED_PRS } from './fixtures.js';

describe('manual refresh journey', () => {
    let github: GitHubMock;
    const pages: Page[] = [];

    beforeAll(async () => {
        github = await installGitHubApiMock();
    });

    afterAll(async () => {
        await Promise.all(pages.map((page) => page.close()));
        await github.close();
    });

    it('uses popup-to-background messaging and persists the deterministic update', async () => {
        const page = await openSeededPopup(github, {
            data: appData([POPULATED_PRS[0]]),
        });
        pages.push(page);
        await waitForText(page, 'li', POPULATED_PRS[0].title);
        github.setScenario({ pullRequests: REFRESHED_PRS });
        github.resetRequests();
        await resetManualRefreshThrottle();

        await page.click('[aria-label="Refresh Pull Requests"]');
        await page.waitForSelector('[data-screen="loading"]');
        await waitForText(page, 'li', 'Deterministic refresh result');
        await waitForDashboard(page);

        expect(github.requests).toContain('https://api.github.com/user');
        expect(
            github.requests.some((url) => url.includes('/search/issues'))
        ).toBe(true);
        const stored = await readAppData(page);
        expect(stored.pullRequests.map((pr) => pr.title)).toEqual([
            'Deterministic refresh result',
        ]);
    });
});
