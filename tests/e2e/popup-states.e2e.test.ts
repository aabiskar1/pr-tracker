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
import {
    appData,
    FIXED_UPDATED_AT,
    POPULATED_PRS,
    TEST_PASSWORD,
} from './fixtures.js';

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

    it.each(['light', 'dark'] as const)(
        'keeps card titles, metadata, and all status badges readable in %s',
        async (theme) => {
            const titles = [
                'Explain a long pull request title without hiding its useful context '.repeat(
                    4
                ),
                'unbroken-title-'.repeat(30),
            ];
            const prs = POPULATED_PRS.map((pr, index) => ({
                ...pr,
                title: titles[index] ?? pr.title,
            }));
            const page = await openSeededPopup(github, {
                theme,
                data: appData(prs),
            });
            pages.push(page);

            await page.evaluateOnNewDocument(() => {
                Date.now = () => Date.parse('2026-10-01T12:00:00.000Z');
            });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForText(page, 'li', titles[0]);
            // Let startup refresh finish before restoring the exact visual fixture.
            await expect
                .poll(async () => (await readAppData(page)).lastUpdated)
                .not.toBe(FIXED_UPDATED_AT);
            await writeAppData(page, appData(prs));
            await page.waitForSelector(
                '.pr-card-accent [data-ci-status="failing"]'
            );

            for (const width of [640, 750]) {
                await page.setViewport({ width, height: 600 });
                const cards = await page.$$eval('.pr-card-accent', (elements) =>
                    elements.map((card) => {
                        const title = card.querySelector('h3')!;
                        const style = getComputedStyle(title);
                        const bounds = card.getBoundingClientRect();
                        const badges = Array.from(
                            card.querySelectorAll(
                                '[data-ci-status], [data-review-status]'
                            )
                        );
                        const luminance = (colour: string) => {
                            const channels = colour
                                .match(/[\d.]+/g)!
                                .slice(0, 3);
                            return channels.reduce((sum, channel, index) => {
                                const value = Number(channel) / 255;
                                const linear =
                                    value <= 0.04045
                                        ? value / 12.92
                                        : ((value + 0.055) / 1.055) ** 2.4;
                                return (
                                    sum +
                                    linear * [0.2126, 0.7152, 0.0722][index]
                                );
                            }, 0);
                        };
                        return {
                            title: title.textContent,
                            fontSize: style.fontSize,
                            lineHeight: style.lineHeight,
                            weight: Number(style.fontWeight),
                            titleContrast: (() => {
                                const foreground = luminance(style.color);
                                const background = luminance(
                                    getComputedStyle(card).backgroundColor
                                );
                                return (
                                    (Math.max(foreground, background) + 0.05) /
                                    (Math.min(foreground, background) + 0.05)
                                );
                            })(),
                            badgeWeights: badges.map(
                                (badge) => getComputedStyle(badge).fontWeight
                            ),
                            badgePresentation: badges.map((badge) => {
                                const computed = getComputedStyle(badge);
                                const bounds = badge.getBoundingClientRect();
                                return {
                                    size: computed.fontSize,
                                    lineHeight: computed.lineHeight,
                                    foreground: computed.color,
                                    background: computed.backgroundColor,
                                    pending:
                                        badge.getAttribute('data-ci-status') ===
                                            'pending' ||
                                        badge.getAttribute(
                                            'data-review-status'
                                        ) === 'pending',
                                    textColours: Array.from(
                                        badge.querySelectorAll('span')
                                    ).map(
                                        (text) => getComputedStyle(text).color
                                    ),
                                    icons: Array.from(
                                        badge.querySelectorAll('svg')
                                    ).map((icon) => {
                                        const style = getComputedStyle(icon);
                                        const rect =
                                            icon.getBoundingClientRect();
                                        return {
                                            colour: style.color,
                                            fill: style.fill,
                                            width: rect.width,
                                            height: rect.height,
                                            centerOffset:
                                                rect.top +
                                                rect.height / 2 -
                                                (bounds.top +
                                                    bounds.height / 2),
                                        };
                                    }),
                                };
                            }),
                            wrap: style.overflowWrap,
                            clipped: card.scrollWidth > card.clientWidth,
                            childrenFit: Array.from(
                                card.querySelectorAll('h3, span, img, button')
                            ).every((element) => {
                                const rect = element.getBoundingClientRect();
                                return (
                                    rect.left >= bounds.left &&
                                    rect.right <= bounds.right
                                );
                            }),
                            contrasts: badges.map((badge) => {
                                const computed = getComputedStyle(badge);
                                const foreground = luminance(computed.color);
                                const background = luminance(
                                    computed.backgroundColor
                                );
                                return (
                                    (Math.max(foreground, background) + 0.05) /
                                    (Math.min(foreground, background) + 0.05)
                                );
                            }),
                            labels: badges.map((badge) =>
                                badge.getAttribute('aria-label')
                            ),
                            ageClass: card.querySelector(
                                '.text-xs.whitespace-nowrap'
                            )!.className,
                        };
                    })
                );
                expect(cards).toHaveLength(4);
                expect(new Set(cards.flatMap((card) => card.labels))).toEqual(
                    new Set([
                        'CI: passing',
                        'CI: failing',
                        'CI: pending',
                        'Review: approved',
                        'Review: changes-requested',
                        'Review: pending',
                    ])
                );
                expect(cards[0].title).toBe(titles[0]);
                expect(
                    cards.some((card) => card.title?.includes(titles[1]))
                ).toBe(true);
                for (const card of cards) {
                    expect(card.weight).toBe(500);
                    expect(card.fontSize).toBe('13px');
                    expect(card.lineHeight).toBe('19.5px');
                    expect(card.titleContrast).toBeGreaterThanOrEqual(4.5);
                    expect(card.badgeWeights).toEqual(['400', '400']);
                    for (const badge of card.badgePresentation) {
                        expect(badge.size).toBe('12px');
                        expect(badge.lineHeight).toBe('16px');
                        expect(badge.foreground).toBe('rgb(255, 255, 255)');
                        if (badge.pending) {
                            expect(badge.background).toBe('rgb(219, 171, 9)');
                        }
                        expect(badge.textColours).toEqual([
                            badge.foreground,
                            badge.foreground,
                        ]);
                        expect(badge.icons).toHaveLength(2);
                        for (const icon of badge.icons) {
                            expect(icon.colour).toBe(badge.foreground);
                            expect(icon.fill).toBe(badge.foreground);
                            expect(icon.width).toBe(12);
                            expect(icon.height).toBe(12);
                            expect(Math.abs(icon.centerOffset)).toBeLessThan(
                                0.1
                            );
                        }
                    }
                    expect(card.wrap).toBe('anywhere');
                    expect(card.clipped).toBe(false);
                    expect(card.childrenFit).toBe(true);
                    expect(card.contrasts).toHaveLength(2);
                    for (const [index, contrast] of card.contrasts.entries()) {
                        // Pending intentionally preserves the original yellow/white palette.
                        if (!card.badgePresentation[index].pending) {
                            expect(contrast).toBeGreaterThanOrEqual(4.5);
                        }
                    }
                    expect(card.labels[0]).toMatch(/^CI: /);
                    expect(card.labels[1]).toMatch(/^Review: /);
                    expect(card.ageClass).toContain(
                        'text-age-stale-foreground'
                    );
                }
            }

            await page.hover('.pr-card-link');
            expect(
                await page.$eval(
                    '.pr-card-title',
                    (title) => getComputedStyle(title).textDecorationLine
                )
            ).toBe('underline');
            // Traverse with the keyboard to prove the link has a visible focus state.
            await page.click('h2');
            for (let index = 0; index < 40; index++) {
                await page.keyboard.press('Tab');
                if (
                    await page.$eval(
                        '.pr-card-link',
                        (link) => link === document.activeElement
                    )
                )
                    break;
            }
            const focus = await page.$eval('.pr-card-link', (link) => ({
                visible: link.matches(':focus-visible'),
                outline: getComputedStyle(link).outlineStyle,
                width: getComputedStyle(link).outlineWidth,
                offset: getComputedStyle(link).outlineOffset,
            }));
            expect(focus).toEqual({
                visible: true,
                outline: 'solid',
                width: '2px',
                offset: '-3px',
            });
        }
    );

    it.each([
        [
            'light',
            {
                input: ['rgb(255, 255, 255)', 'rgb(17, 24, 39)'],
                inputBorder: 'rgb(209, 213, 219)',
                placeholder: 'oklab(0.210081 -0.00294439 -0.0316202 / 0.5)',
                filter: 'rgb(255, 255, 255)',
                card: 'rgb(255, 255, 255)',
                primary: ['rgb(80, 70, 228)', 'rgb(255, 255, 255)'],
                secondary: ['rgb(243, 244, 246)', 'rgb(55, 65, 81)'],
                ci: ['rgb(40, 167, 69)', 'rgb(255, 255, 255)'],
                review: ['rgb(219, 171, 9)', 'rgb(255, 255, 255)'],
            },
        ],
        [
            'dark',
            {
                input: ['rgb(34, 39, 46)', 'rgb(230, 237, 243)'],
                inputBorder: 'rgb(48, 54, 61)',
                placeholder: 'oklab(0.942533 -0.00486067 -0.00988358 / 0.5)',
                filter: 'rgb(34, 39, 46)',
                card: 'rgb(34, 39, 46)',
                primary: ['rgb(35, 134, 54)', 'rgb(255, 255, 255)'],
                secondary: ['rgb(33, 38, 45)', 'rgb(230, 237, 243)'],
                ci: ['rgb(40, 167, 69)', 'rgb(230, 237, 243)'],
                review: ['rgb(219, 171, 9)', 'rgb(230, 237, 243)'],
            },
        ],
    ] as const)(
        'preserves baseline production surfaces and controls in %s mode',
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
