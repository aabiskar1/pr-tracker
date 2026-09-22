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

    it.each([
        [
            'light',
            {
                input: ['rgb(255, 255, 255)', 'rgb(31, 35, 40)'],
                inputBorder: 'rgb(175, 184, 193)',
                placeholder: 'rgb(89, 99, 110)',
                filter: 'rgb(246, 248, 250)',
                card: 'rgb(255, 255, 255)',
                primary: ['rgb(9, 105, 218)', 'rgb(255, 255, 255)'],
                secondary: ['rgb(246, 248, 250)', 'rgb(31, 35, 40)'],
                ci: ['rgb(218, 251, 225)', 'rgb(17, 99, 41)'],
                review: ['rgb(221, 244, 255)', 'rgb(5, 80, 174)'],
            },
        ],
        [
            'dark',
            {
                input: ['rgb(13, 17, 23)', 'rgb(240, 246, 252)'],
                inputBorder: 'rgb(89, 99, 110)',
                placeholder: 'rgb(157, 167, 179)',
                filter: 'rgb(33, 38, 45)',
                card: 'rgb(22, 27, 34)',
                primary: ['rgb(88, 166, 255)', 'rgb(13, 17, 23)'],
                secondary: ['rgb(33, 38, 45)', 'rgb(240, 246, 252)'],
                ci: ['rgb(22, 53, 31)', 'rgb(126, 231, 135)'],
                review: ['rgb(31, 59, 91)', 'rgb(121, 192, 255)'],
            },
        ],
    ] as const)(
        'applies semantic production surfaces and controls in %s mode',
        async (theme, expected) => {
            github.setScenario({ pullRequests: POPULATED_PRS });
            const page = await openSeededPopup(github, { theme });
            pages.push(page);

            const styles = await page.evaluate(() => {
                const style = (selector: string, pseudo?: string) => {
                    const element = document.querySelector(selector);
                    if (!element)
                        throw new Error(`Missing element: ${selector}`);
                    return getComputedStyle(element, pseudo);
                };
                const colours = (selector: string) => {
                    const computed = style(selector);
                    return [computed.backgroundColor, computed.color];
                };
                const searchSelector =
                    'input[aria-label="Search Pull Requests"]';

                return {
                    search: colours(searchSelector),
                    searchBorder: style(searchSelector).borderTopColor,
                    searchPlaceholder: style(searchSelector, '::placeholder')
                        .color,
                    customQuery: colours(
                        'input[aria-label="Custom GitHub search query"]'
                    ),
                    filter: style('.filter-bar-container').backgroundColor,
                    card: style('li').backgroundColor,
                    primary: colours(
                        'button[aria-label="Refresh Pull Requests"]'
                    ),
                    secondary: colours('button[aria-label="Sign Out"]'),
                    ci: colours(
                        'label[title="Show passing checks"] [data-slot="badge"]'
                    ),
                    review: colours(
                        'label[title="Show pending PRs"] [data-slot="badge"]'
                    ),
                    saveDisabled: (
                        document.querySelector(
                            'button[aria-label="Save custom search query"]'
                        ) as HTMLButtonElement
                    ).disabled,
                };
            });

            expect(styles).toEqual({
                search: expected.input,
                searchBorder: expected.inputBorder,
                searchPlaceholder: expected.placeholder,
                customQuery: expected.input,
                filter: expected.filter,
                card: expected.card,
                primary: expected.primary,
                secondary: expected.secondary,
                ci: expected.ci,
                review: expected.review,
                saveDisabled: true,
            });
        }
    );

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
