import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

    afterEach(async () => {
        await Promise.all(pages.splice(0).map((page) => page.close()));
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

    it('preserves the cached snapshot when one required PR detail fails, then recovers', async () => {
        const cached = appData([POPULATED_PRS[0], POPULATED_PRS[1]]);
        const page = await openSeededPopup(github, { data: cached });
        pages.push(page);
        const persistedBeforeFailure = await readAppData(page);
        const latestPrs = [
            {
                ...POPULATED_PRS[0],
                title: 'Recovered complete PR detail',
            },
            POPULATED_PRS[1],
        ];
        github.setScenario({
            pullRequests: latestPrs,
            detailStatusByPrId: { [POPULATED_PRS[1].id]: 503 },
        });
        await page.click('[aria-label="Refresh Pull Requests"]');
        await waitForText(
            page,
            '[role="alert"]',
            'could not be refreshed completely'
        );
        await waitForDashboard(page);

        expect(await readAppData(page)).toEqual(persistedBeforeFailure);
        expect(await page.$$('li')).toHaveLength(
            persistedBeforeFailure.pullRequests.length
        );
        await waitForText(page, 'li', POPULATED_PRS[0].title);

        github.setScenario({ pullRequests: latestPrs });
        await resetManualRefreshThrottle();
        await page.click('[aria-label="Refresh Pull Requests"]');
        await waitForText(page, 'li', latestPrs[0].title);
        await waitForDashboard(page);

        await expect
            .poll(async () => {
                const data = await readAppData(page);
                return data.oldPullRequests?.map((pr) => pr.title);
            })
            .toEqual(latestPrs.map((pr) => pr.title));

        const recovered = await readAppData(page);
        expect(recovered.pullRequests.map((pr) => pr.id)).toEqual(
            latestPrs.map((pr) => pr.id)
        );
        expect(recovered.oldPullRequests?.map((pr) => pr.title)).toEqual(
            latestPrs.map((pr) => pr.title)
        );
    });

    it('resets manual and notification throttles between scenarios', async () => {
        const initialPrs = [POPULATED_PRS[0]];
        const refreshedPrs = [POPULATED_PRS[0], POPULATED_PRS[1]];

        const firstPage = await openSeededPopup(github, {
            data: appData(initialPrs),
        });
        pages.push(firstPage);
        github.setScenario({ pullRequests: refreshedPrs });
        github.resetRequests();

        await firstPage.click('[aria-label="Refresh Pull Requests"]');
        await waitForText(firstPage, 'li', POPULATED_PRS[1].title);
        await expect
            .poll(
                async () =>
                    Object.keys(
                        await firstPage.evaluate(() =>
                            chrome.notifications.getAll()
                        )
                    ).length
            )
            .toBe(1);

        await firstPage.close();
        pages.pop();

        const secondPage = await openSeededPopup(github, {
            data: appData(initialPrs),
        });
        pages.push(secondPage);
        expect(
            Object.keys(
                await secondPage.evaluate(() => chrome.notifications.getAll())
            )
        ).toHaveLength(0);
        github.setScenario({ pullRequests: refreshedPrs });
        github.resetRequests();

        await secondPage.click('[aria-label="Refresh Pull Requests"]');
        await waitForText(secondPage, 'li', POPULATED_PRS[1].title);

        expect(github.requests).toContain('https://api.github.com/user');
        await expect
            .poll(
                async () =>
                    Object.keys(
                        await secondPage.evaluate(() =>
                            chrome.notifications.getAll()
                        )
                    ).length
            )
            .toBe(1);
    });
});
