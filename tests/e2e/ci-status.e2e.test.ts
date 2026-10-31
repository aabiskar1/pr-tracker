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
import { openExtensionPopup } from './setup.js';

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
const advancedButton = 'button[aria-label="Advanced CI filters"]';
const advancedMenu = '[popover][aria-label="Advanced CI filters"]';
const openAdvanced = async (page: Page) => {
    if (!(await page.$(`${advancedMenu}:popover-open`)))
        await page.click(advancedButton);
    await page.waitForSelector(`${advancedMenu}:popover-open`);
    await page.waitForSelector(`${advancedButton}[aria-expanded="true"]`);
};
const toggle = async (page: Page, status: CIStatus) => {
    if (status === 'no-ci' || status === 'unknown') await openAdvanced(page);
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
            await page.close();
            page = await openExtensionPopup();
            await waitForDashboard(page);
            await vi.waitFor(async () =>
                expect(await cards(page)).toEqual(['CI fixture unknown'])
            );
            expect(await page.$(`${advancedMenu}:popover-open`)).toBeNull();
            expect(
                await page.$eval(advancedButton, (el) =>
                    el.getAttribute('data-filtered')
                )
            ).toBe('true');
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
        'supports the Advanced menu, keyboard dismissal and empty CI selection in %s',
        async (theme) => {
            page = await openSeededPopup(github, { data: appData(prs), theme });
            expect(await page.$(`${advancedMenu}:popover-open`)).toBeNull();
            expect(
                await page.$eval(advancedButton, (el) =>
                    el.getAttribute('data-filtered')
                )
            ).toBe('false');
            expect(
                await page.$$eval(
                    '.filter-bar-container [data-slot="badge"][data-ci-status]',
                    (els) =>
                        els.map((el) => ({
                            status: el.getAttribute('data-ci-status'),
                            background: getComputedStyle(el).backgroundColor,
                        }))
                )
            ).toEqual([
                { status: 'passing', background: 'rgb(40, 167, 69)' },
                { status: 'failing', background: 'rgb(203, 36, 49)' },
                { status: 'pending', background: 'rgb(219, 171, 9)' },
            ]);
            const before = await page.$eval(
                '.filter-bar-container',
                (el) => el.getBoundingClientRect().height
            );
            await page.focus(advancedButton);
            await page.keyboard.press('Enter');
            await page.waitForSelector(`${advancedMenu}:popover-open`);
            await page.waitForFunction(
                () =>
                    document.activeElement?.getAttribute('data-ci-status') ===
                    'no-ci'
            );
            expect(
                await page.$$eval(`${advancedMenu} input`, (els) =>
                    els.map((el) => (el as HTMLInputElement).checked)
                )
            ).toEqual([true, true]);
            expect(
                await page.$eval(
                    '.filter-bar-container',
                    (el) => el.getBoundingClientRect().height
                )
            ).toBe(before);
            const surface = await page.$eval(advancedMenu, (el) => ({
                background: getComputedStyle(el).backgroundColor,
                overflow: el.scrollWidth > el.clientWidth,
            }));
            expect(surface.background).toBe(
                theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(34, 39, 46)'
            );
            expect(surface.overflow).toBe(false);
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
                path: `screenshots/ci-advanced-${theme}.png`,
            });
            await page.keyboard.press('Space');
            await page.keyboard.press('Tab');
            expect(
                await page.$eval(
                    `${advancedMenu} input[data-ci-status="unknown"]`,
                    (el) => el === document.activeElement
                )
            ).toBe(true);
            await page.keyboard.press('Space');
            await vi.waitFor(async () =>
                expect(
                    (await readAppData(page)).preferences?.filters?.ciStatus
                ).toEqual(['passing', 'failing', 'pending'])
            );
            await vi.waitFor(async () =>
                expect(await cards(page)).toEqual([
                    'CI fixture passing',
                    'CI fixture failing',
                    'CI fixture pending',
                ])
            );
            expect(
                await page.$eval(advancedButton, (el) =>
                    el.getAttribute('data-filtered')
                )
            ).toBe('true');
            expect(
                await page.$(`${advancedButton} .ci-advanced-indicator`)
            ).not.toBeNull();
            await page.keyboard.press('Escape');
            await page.waitForSelector(
                `${advancedButton}[aria-expanded="false"]`
            );
            expect(
                await page.$eval(
                    advancedButton,
                    (el) => el === document.activeElement
                )
            ).toBe(true);
            // A second activation closes it; outside pointer and Tab also dismiss it.
            await openAdvanced(page);
            await page.click(advancedButton);
            await page.waitForSelector(
                `${advancedButton}[aria-expanded="false"]`
            );
            await openAdvanced(page);
            await page.click('[aria-label="Search Pull Requests"]');
            await page.waitForSelector(
                `${advancedButton}[aria-expanded="false"]`
            );
            await openAdvanced(page);
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            await page.waitForSelector(
                `${advancedButton}[aria-expanded="false"]`
            );
            expect(
                await page.evaluate(() =>
                    document.activeElement?.textContent?.trim()
                )
            ).toBe('Reset Filters');
            for (const status of ['passing', 'failing', 'pending'] as const)
                await toggle(page, status);
            // Existing convention: empty means no CI restriction, not an empty result.
            await vi.waitFor(async () =>
                expect(
                    (await readAppData(page)).preferences?.filters?.ciStatus
                ).toEqual([])
            );
            await vi.waitFor(async () =>
                expect(await cards(page)).toHaveLength(5)
            );
            expect(
                await page.$eval(advancedButton, (el) =>
                    el.getAttribute('title')
                )
            ).toBe('All CI states included (no selection)');
            await page.close();
            page = await openExtensionPopup();
            await waitForDashboard(page);
            expect(
                (await readAppData(page)).preferences?.filters?.ciStatus
            ).toEqual([]);
            await vi.waitFor(async () =>
                expect(await cards(page)).toHaveLength(5)
            );
            await page.click('button::-p-text(Reset Filters)');
            await vi.waitFor(async () =>
                expect(
                    (await readAppData(page)).preferences?.filters?.ciStatus
                ).toEqual(states)
            );
            expect(
                await page.$eval(advancedButton, (el) =>
                    el.getAttribute('data-filtered')
                )
            ).toBe('false');
            await openAdvanced(page);
            expect(
                await page.$$eval(`${advancedMenu} input`, (els) =>
                    els.map((el) => (el as HTMLInputElement).checked)
                )
            ).toEqual([true, true]);
        }
    );

    it.each([360, 600, 750])(
        'keeps the Advanced menu inside a %ipx viewport without blocking scrolling',
        async (width) => {
            page = await openSeededPopup(github, { data: appData(prs) });
            await page.setViewport({ width, height: 230 });
            await openAdvanced(page);
            const bounds = await page.$eval(advancedMenu, (el) => {
                const r = el.getBoundingClientRect();
                return {
                    left: r.left,
                    right: r.right,
                    top: r.top,
                    bottom: r.bottom,
                    bodyOverflow: getComputedStyle(document.body).overflow,
                };
            });
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(width);
            expect(bounds.top).toBeGreaterThanOrEqual(0);
            expect(bounds.bottom).toBeLessThanOrEqual(230);
            expect(bounds.bodyOverflow).not.toBe('hidden');
            // Resizing and scrolling dismiss an overlay anchored to the old position.
            await page.setViewport({ width, height: 240 });
            await page.waitForSelector(
                `${advancedButton}[aria-expanded="false"]`
            );
            await openAdvanced(page);
            await page.mouse.move(width - 8, 220);
            await page.mouse.wheel({ deltaY: 200 });
            await page.waitForFunction(() => window.scrollY > 0);
            await page.waitForSelector(
                `${advancedButton}[aria-expanded="false"]`
            );
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
