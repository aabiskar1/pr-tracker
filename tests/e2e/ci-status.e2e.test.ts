import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Page } from 'puppeteer';
import {
    installGitHubApiMock,
    openCleanPopup,
    seedEncryptedState,
    openSeededPopup,
    readAppData,
    waitForDashboard,
    type GitHubMock,
} from './harness.js';
import { appData, POPULATED_PRS } from './fixtures.js';
import type { CIStatus } from '../../src/types';

const states: CIStatus[] = [
    'passing',
    'failing',
    'pending',
    'no-ci',
    'unknown',
];
const prs = states.map((ci_status, index) => ({
    ...POPULATED_PRS[0],
    id: 800 + index,
    title: `CI fixture ${ci_status}`,
    ci_status,
}));
const cards = (page: Page) =>
    page.$$eval('.pr-card-title', (elements) =>
        elements.map((el) => el.textContent?.trim())
    );
const toggle = async (page: Page, status: CIStatus) => {
    const selector = `label:has([data-ci-status="${status}"])`;
    const wasSelected = await page.$eval(
        `${selector} input`,
        (el) => (el as HTMLInputElement).checked
    );
    await page.click(selector);
    await vi.waitFor(async () =>
        expect(
            (await readAppData(page)).preferences?.filters?.ciStatus.includes(
                status
            )
        ).toBe(!wasSelected)
    );
    await page.waitForFunction(
        (selector, selected) =>
            document.querySelector<HTMLInputElement>(`${selector} input`)
                ?.checked === selected,
        { timeout: 5000 },
        selector,
        !wasSelected
    );
};

describe('five CI states', () => {
    let github: GitHubMock;
    let page: Page;
    beforeAll(async () => {
        github = await installGitHubApiMock();
    });
    afterEach(async () => {
        await page?.close();
    });
    afterAll(async () => {
        await github.close();
    });

    it.each(['light', 'dark'] as const)(
        'renders and persists independent filters in %s',
        async (theme) => {
            page = await openSeededPopup(github, { data: appData(prs), theme });
            expect(
                await page.$$('.pr-card-accent [data-ci-status]')
            ).toHaveLength(4);
            expect(
                await page.$('.pr-card-accent [data-ci-status="no-ci"]')
            ).toBeNull();
            const unknown = await page.$eval(
                '.pr-card-accent [data-ci-status="unknown"]',
                (el) => ({
                    label: el.getAttribute('aria-label'),
                    title: el.getAttribute('title'),
                    text: el.textContent,
                    background: getComputedStyle(el).backgroundColor,
                })
            );
            expect(unknown.label).toBe('CI: unknown');
            expect(unknown.title).toBe(
                'CI status could not be determined reliably'
            );
            expect(unknown.text).toContain('Unknown');
            expect(unknown.background).not.toBe(
                await page.$eval(
                    '.pr-card-accent [data-ci-status="pending"]',
                    (el) => getComputedStyle(el).backgroundColor
                )
            );
            for (const status of states.slice(1)) await toggle(page, status);
            for (const status of states) {
                if (status !== 'passing') {
                    await toggle(page, status);
                    await toggle(page, states[states.indexOf(status) - 1]);
                }
                await page.waitForFunction(
                    (expected) =>
                        document.querySelectorAll('.pr-card-title').length ===
                            1 &&
                        document
                            .querySelector('.pr-card-title')
                            ?.textContent?.trim() === expected,
                    { timeout: 5000 },
                    `CI fixture ${status}`
                );
                expect(await cards(page)).toEqual([`CI fixture ${status}`]);
            }
            await vi.waitFor(async () =>
                expect(
                    (await readAppData(page)).preferences?.filters?.ciStatus
                ).toEqual(['unknown'])
            );
            await page.reload();
            await waitForDashboard(page);
            await vi.waitFor(async () =>
                expect(await cards(page)).toEqual(['CI fixture unknown'])
            );
            await page.click('.filter-bar-container button:not([aria-label])');
            await page.waitForFunction(
                () => document.querySelectorAll('.pr-card-title').length === 5
            );
            await vi.waitFor(async () =>
                expect(
                    (await readAppData(page)).preferences?.filters?.ciStatus
                ).toEqual(states)
            );
            await page.reload();
            await waitForDashboard(page);
            await vi.waitFor(async () =>
                expect(await cards(page)).toHaveLength(5)
            );
            expect(
                (await readAppData(page)).preferences?.filters?.ciStatus
            ).toEqual(states);
            await page.screenshot({
                path: `screenshots/ci-status-${theme}.png`,
                fullPage: true,
            });
        }
    );

    it.each(['light', 'dark'] as const)(
        'keeps neutral filter pills compact and keyboard accessible in %s',
        async (theme) => {
            page = await openSeededPopup(github, { data: appData(prs), theme });
            const inspect = () =>
                page.$$eval(
                    '.filter-bar-container [data-ci-status]',
                    (elements) =>
                        elements.map((el) => {
                            const css = getComputedStyle(el);
                            return {
                                status: el.getAttribute('data-ci-status'),
                                background: css.backgroundColor,
                                geometry: {
                                    height: el.getBoundingClientRect().height,
                                    padding: css.padding,
                                    radius: css.borderRadius,
                                },
                            };
                        })
                );
            const selected = await inspect();
            const barHeight = await page.$eval(
                '.filter-bar-container',
                (el) => el.getBoundingClientRect().height
            );
            expect(selected.slice(0, 3).map((item) => item.background)).toEqual(
                ['rgb(40, 167, 69)', 'rgb(203, 36, 49)', 'rgb(219, 171, 9)']
            );
            for (const status of ['no-ci', 'unknown']) {
                const badge = `.filter-bar-container [data-ci-status="${status}"]`;
                const input = `label:has([data-ci-status="${status}"]) input`;
                const pill = selected.find((item) => item.status === status)!;
                expect(pill.background).toBe(
                    theme === 'light' ? 'rgb(229, 231, 235)' : 'rgb(55, 65, 81)'
                );
                expect(pill.geometry).toEqual(selected[0]!.geometry);
                await page.focus(input);
                await page.keyboard.press('Tab');
                await page.keyboard.down('Shift');
                await page.keyboard.press('Tab');
                await page.keyboard.up('Shift');
                expect(
                    await page.$eval(
                        input,
                        (el) => el === document.activeElement
                    )
                ).toBe(true);
                expect(
                    await page.$eval(badge, (el) => {
                        const css = getComputedStyle(el);
                        return {
                            width: css.outlineWidth,
                            style: css.outlineStyle,
                        };
                    })
                ).toEqual({ width: '2px', style: 'solid' });
                await page.keyboard.press('Space');
                await page.waitForSelector(`${badge}[data-selected="false"]`);
                await vi.waitFor(async () =>
                    expect(
                        (
                            await readAppData(page)
                        ).preferences?.filters?.ciStatus.includes(
                            status as CIStatus
                        )
                    ).toBe(false)
                );
            }
            await toggle(page, 'passing');
            const unselected = await inspect();
            for (const status of ['no-ci', 'unknown']) {
                const pill = unselected.find((item) => item.status === status)!;
                expect(pill.background).toBe('rgba(0, 0, 0, 0)');
                expect(pill.background).not.toBe(
                    selected.find((item) => item.status === status)!.background
                );
                expect(pill.geometry).toEqual(unselected[0]!.geometry);
            }
            await toggle(page, 'passing');
            await page.hover('label:has([data-ci-status="no-ci"])');
            expect(
                await page.$eval(
                    '.filter-bar-container [data-ci-status="no-ci"]',
                    (el) => getComputedStyle(el).boxShadow
                )
            ).not.toBe('none');
            await page.mouse.move(0, 0);
            await page.evaluate(() =>
                (document.activeElement as HTMLElement)?.blur()
            );
            expect(await cards(page)).toEqual([
                'CI fixture passing',
                'CI fixture failing',
                'CI fixture pending',
            ]);
            expect(
                await page.$('.pr-card-accent [data-ci-status="no-ci"]')
            ).toBeNull();
            const layout = await page.$eval('.filter-bar-container', (el) => ({
                height: el.getBoundingClientRect().height,
                overflow: el.scrollWidth > el.clientWidth,
            }));
            // Outline badges add only their existing 1px borders, with no extra row.
            expect(layout.height).toBeLessThanOrEqual(barHeight + 2);
            expect(layout.overflow).toBe(false);
            await page.screenshot({
                path: `screenshots/ci-filters-unselected-${theme}.png`,
                fullPage: true,
            });
        }
    );

    it.each([true, false])(
        'migrates encrypted legacy preferences (all=%s) without losing other preferences',
        async (all) => {
            const data = appData(prs);
            data.preferences!.filters!.ciStatus = all
                ? ['passing', 'failing', 'pending']
                : ['passing'];
            delete data.preferences!.filters!.ciStatusVersion;
            data.preferences!.filters!.showReviewed = false;
            data.preferences!.notificationsEnabled = false;
            data.preferences!.sort = 'oldest';
            github.setScenario({ pullRequests: prs });
            page = await openCleanPopup();
            await seedEncryptedState(page, { data });
            await page.reload();
            await waitForDashboard(page);
            await vi.waitFor(async () =>
                expect(await cards(page)).toHaveLength(all ? 5 : 1)
            );
            // An unrelated preference mutation persists migration through the real encrypted writer.
            await page.select(
                'select[aria-label="Sort pull requests"]',
                'newest'
            );
            await vi.waitFor(async () =>
                expect((await readAppData(page)).preferences?.sort).toBe(
                    'newest'
                )
            );
            await page.reload();
            await waitForDashboard(page);
            const saved = (await readAppData(page)).preferences!;
            expect(saved.filters?.ciStatus).toEqual(all ? states : ['passing']);
            expect(saved.filters?.ciStatusVersion).toBe(1);
            expect(saved.filters?.showReviewed).toBe(false);
            expect(saved.notificationsEnabled).toBe(false);
            expect(saved.sort).toBe('newest');
            await vi.waitFor(async () =>
                expect(await cards(page)).toHaveLength(all ? 5 : 1)
            );
        }
    );
});
