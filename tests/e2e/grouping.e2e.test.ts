import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { getBrowser, getExtensionId, openExtensionPopup } from './setup';
import {
    installGitHubApiMock,
    openSeededPopup,
    readAppData,
    resetManualRefreshThrottle,
    waitForDashboard,
    waitForText,
    writeAppData,
    type GitHubMock,
} from './harness';
import { appData, POPULATED_PRS, TEST_PASSWORD } from './fixtures';
import type { PullRequest } from '../../src/types';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import puppeteer, { type Browser } from 'puppeteer';
import { puppeteerConfig } from '../../puppeteer.config.mjs';
import { seedEncryptedState } from './harness';

const toggle = (key: string) => `[data-repository-group="${key}"] h2 button`;
const cards = '.pr-card-accent';
async function removeTestProfile(profile: string) {
    const resolved = path.resolve(profile);
    if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('pr-tracker-grouping-profile-')
    )
        throw new Error('Unexpected test profile path');
    await fs.rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
    });
}
const groupingFixture = (count: number, repositories: number): PullRequest[] =>
    Array.from({ length: count }, (_, i) => ({
        ...POPULATED_PRS[i % POPULATED_PRS.length],
        id: 1000 + i,
        title: `PR ${i}: ${'Keep detailed status, author and reviewer context readable '.repeat(2)}`,
        repository: {
            name: `repository-${i % repositories}`,
            full_name: `Acme/repository-${i % repositories}`,
        },
        html_url: `https://github.com/Acme/repository-${i % repositories}/pull/${1000 + i}`,
        updated_at: `2026-11-${String(1 + (i % 12)).padStart(2, '0')}T12:00:00Z`,
    }));

describe('repository grouping', () => {
    let github: GitHubMock;
    const pages: Page[] = [];
    beforeAll(async () => {
        github = await installGitHubApiMock();
    });
    afterEach(async () => {
        for (const page of pages.splice(0)) {
            if (page.isClosed()) continue;
            // Stop remembered-session auto-refresh before the next scenario opens.
            expect(
                await page.evaluate(() =>
                    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' })
                )
            ).toBe(true);
            await page.close();
        }
    });
    afterAll(async () => {
        await github.close();
    });

    it('defaults to All PRs and preserves collapse choices through view changes, search, reset filters, reopen and unlock', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        expect(
            await page.$eval(
                '[name="pr-grouping"]',
                (element) => (element as HTMLSelectElement).value
            )
        ).toBe('none');
        expect(
            await page.$eval('[name="pr-grouping"]', (select) => ({
                label: (select as HTMLSelectElement).labels?.[0]?.textContent,
                options: [...(select as HTMLSelectElement).options].map(
                    (option) => [option.value, option.text]
                ),
            }))
        ).toEqual({
            label: 'View',
            options: [
                ['none', 'All PRs'],
                ['repository', 'By repository'],
            ],
        });
        expect(await page.$('[data-testid="repository-groups"]')).toBeNull();
        expect((await readAppData(page)).preferences?.grouping).toBeUndefined();
        await page.select('[name="pr-grouping"]', 'repository');
        await page.waitForSelector(toggle('acme/auth-service'));
        expect(await page.$$(cards)).toHaveLength(4);
        await page.focus('[name="pr-grouping"]');
        await page.keyboard.press('Tab');
        expect(
            await page.evaluate(() => document.activeElement?.textContent)
        ).toBe('Expand all');
        await page.keyboard.press('Tab');
        expect(
            await page.evaluate(() => document.activeElement?.textContent)
        ).toBe('Collapse all');
        await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        await page.keyboard.up('Shift');
        expect(
            await page.evaluate(() => document.activeElement?.textContent)
        ).toBe('Expand all');
        await page.focus(toggle('acme/auth-service'));
        await page.keyboard.press('Space');
        await page.waitForSelector(
            `${toggle('acme/auth-service')}[aria-expanded="false"]`
        );
        expect(
            await page.evaluate(() =>
                document.activeElement?.getAttribute('aria-expanded')
            )
        ).toBe('false');
        await page.keyboard.press('Tab');
        expect(
            await page.evaluate(
                () =>
                    document.activeElement?.closest<HTMLElement>(
                        '[data-repository-group]'
                    )?.dataset.repositoryGroup
            )
        ).toBe('acme/ui-library');
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.grouping
                        ?.collapsedRepositories
            )
            .toEqual(['acme/auth-service']);
        const saved = await page.evaluate(() =>
            chrome.storage.local.get(['encryptedAppData', 'appDataIv'])
        );
        await page.type(
            '[aria-label="Search Pull Requests"]',
            'authentication'
        );
        await page.waitForSelector(
            `${toggle('acme/auth-service')}[aria-expanded="true"][aria-disabled="true"]`
        );
        expect(await page.$$('[data-repository-group]')).toHaveLength(1);
        expect(await page.$$(cards)).toHaveLength(1);
        await waitForText(page, '#grouping-search-explanation', 'Clear search');
        expect(
            await page.evaluate(() =>
                chrome.storage.local.get(['encryptedAppData', 'appDataIv'])
            )
        ).toEqual(saved);
        await page.click(toggle('acme/auth-service'));
        expect(
            (await readAppData(page)).preferences?.grouping
                ?.collapsedRepositories
        ).toEqual(['acme/auth-service']);
        await page.focus('[aria-label="Search Pull Requests"]');
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.waitForSelector(
            `${toggle('acme/auth-service')}[aria-expanded="false"]`
        );
        await page.select('[name="pr-grouping"]', 'none');
        await page.waitForSelector('[data-testid="repository-groups"]', {
            hidden: true,
        });
        expect(await page.$$(cards)).toHaveLength(4);
        await page.select('[name="pr-grouping"]', 'repository');
        await page.waitForSelector(
            `${toggle('acme/auth-service')}[aria-expanded="false"]`
        );
        await page.click('.filter-bar-container button:not([aria-label])');
        expect(
            (await readAppData(page)).preferences?.grouping
                ?.collapsedRepositories
        ).toEqual(['acme/auth-service']);
        await page.close();
        pages.splice(pages.indexOf(page), 1);
        const reopened = await openExtensionPopup();
        pages.push(reopened);
        await waitForDashboard(reopened);
        await reopened.waitForSelector(
            `${toggle('acme/auth-service')}[aria-expanded="false"]`
        );
        await reopened.click('[aria-label="Sign Out"]');
        await waitForText(reopened, 'h2', 'Enter Password');
        await reopened.type('#currentPassword', TEST_PASSWORD);
        await reopened.click('[aria-label="Sign In"]');
        await waitForDashboard(reopened);
        await reopened.waitForSelector(
            `${toggle('acme/auth-service')}[aria-expanded="false"]`
        );
        expect((await readAppData(reopened)).preferences?.grouping?.mode).toBe(
            'repository'
        );
        await reopened.click('[aria-label="Sign Out"]');
        await waitForText(reopened, 'h2', 'Enter Password');
        await reopened.click('[aria-label="Full Reset"]');
        await reopened.waitForSelector('[role="dialog"]');
        await reopened.click('[role="dialog"] button:last-child');
        await waitForText(reopened, 'h2', 'GitHub Authentication');
        expect(
            await reopened.evaluate(() =>
                chrome.storage.local.get('encryptedAppData')
            )
        ).toEqual({});
    });

    it('keeps malformed legacy identities separate and collapses them without saving invalid keys', async () => {
        const page = await openSeededPopup(github, { data: appData([]) });
        pages.push(page);
        const invalid = [1, 2].map((id) => ({
            ...POPULATED_PRS[0],
            id,
            html_url: 'invalid-url',
            repository: { name: 'same-name' },
        }));
        await writeAppData(page, appData(invalid));
        await page.waitForFunction(
            () => document.querySelectorAll('.pr-card-accent').length === 2
        );
        await page.select('[name="pr-grouping"]', 'repository');
        await page.waitForSelector(toggle('unavailable:1'));
        expect(await page.$$('[data-repository-group]')).toHaveLength(2);
        await page.click(toggle('unavailable:1'));
        await page.waitForSelector(
            `${toggle('unavailable:1')}[aria-expanded="false"]`
        );
        expect(await page.$$(cards)).toHaveLength(1);
        await expect
            .poll(async () => (await readAppData(page)).preferences?.grouping)
            .toEqual({ mode: 'repository', collapsedRepositories: [] });
        expect((await readAppData(page)).pullRequests).toHaveLength(2);
    });

    it('keeps repository identity and activity in encrypted snapshots after 200 and 304 refreshes', async () => {
        const prs = groupingFixture(5, 2);
        const page = await openSeededPopup(github, { data: appData(prs) });
        pages.push(page);
        github.setScenario({
            pullRequests: prs,
            detailEtag: '"grouping-fields"',
        });
        for (const status of [200, 304]) {
            await resetManualRefreshThrottle();
            await page.click('[aria-label="Refresh Pull Requests"]');
            await waitForDashboard(page);
            await expect
                .poll(
                    async () =>
                        (await readAppData(page)).pullRequests[0].repository
                            .full_name
                )
                .toBe(prs[0].repository.full_name);
            expect((await readAppData(page)).pullRequests[0].updated_at).toBe(
                prs[0].updated_at
            );
            await expect
                .poll(() =>
                    github.detailRequests.some(
                        (request) => request.status === status
                    )
                )
                .toBe(true);
        }
        const encrypted = await page.evaluate(() =>
            chrome.storage.local.get([
                'encryptedAppData',
                'encryptedDetailCache',
            ])
        );
        expect(JSON.stringify(encrypted)).not.toContain('Acme/repository');
        expect(github.requests.some((url) => url.includes('/reviews?'))).toBe(
            true
        );
        expect(
            github.requests.some((url) => url.includes('/check-runs?'))
        ).toBe(true);
    });

    it('batches matching groups, keeps absent choices and restores focus when a focused card disappears', async () => {
        const page = await openSeededPopup(github);
        pages.push(page);
        await page.select('[name="pr-grouping"]', 'repository');
        await page.waitForSelector(toggle('acme/auth-service'));
        await page.evaluate(() =>
            Array.from(document.querySelectorAll('button'))
                .find((button) => button.textContent === 'Collapse all')!
                .click()
        );
        await page.waitForFunction(
            () => document.querySelectorAll('.pr-card-accent').length === 0
        );
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences?.grouping
                        ?.collapsedRepositories.length
            )
            .toBe(4);
        await page.click('[aria-label="Show Drafts"]');
        await page.waitForFunction(
            () =>
                document.querySelectorAll('[data-repository-group]').length ===
                2
        );
        await page.evaluate(() =>
            Array.from(document.querySelectorAll('button'))
                .find((button) => button.textContent === 'Expand all')!
                .click()
        );
        await page.waitForFunction(
            () => document.querySelectorAll('.pr-card-accent').length === 2
        );
        await expect
            .poll(async () =>
                (
                    await readAppData(page)
                ).preferences?.grouping?.collapsedRepositories
                    .slice()
                    .sort()
            )
            .toEqual(['acme/ui-library', 'acme/web-dashboard']);
        const hide = `[data-repository-group="acme/auth-service"] [aria-label="Hide PR"]`;
        await page.focus(hide);
        await page.keyboard.press('Enter');
        await page.waitForSelector(toggle('acme/auth-service'), {
            hidden: true,
        });
        expect(
            await page.evaluate(
                () => (document.activeElement as HTMLSelectElement)?.name
            )
        ).toBe('pr-grouping');
        await page.type(
            '[aria-label="Search Pull Requests"]',
            'no-such-result'
        );
        await waitForText(page, 'p', 'No pull requests found');
        expect(await page.$$('[data-repository-group]')).toHaveLength(0);
    });

    it.each(['light', 'dark'] as const)(
        'separates same-named owners and wraps full identities in the actual Chrome popup in %s',
        async (theme) => {
            const repository = 'repository-'.repeat(9);
            const prs = ['A'.repeat(39), 'B'.repeat(39)].map((owner, i) => ({
                ...POPULATED_PRS[0],
                id: 1100 + i,
                title: `${owner} ${'long-title-'.repeat(35)}`,
                repository: {
                    name: repository,
                    full_name: `${owner}/${repository}`,
                },
                html_url: `https://github.com/${owner}/${repository}/pull/${1100 + i}`,
                updated_at: '2026-11-12T12:00:00Z',
            }));
            const seed = await openSeededPopup(github, {
                data: appData(prs),
                theme,
            });
            const windowSession = await seed.createCDPSession();
            const { windowId } = await windowSession.send(
                'Browser.getWindowForTarget'
            );
            await windowSession.send('Browser.setWindowBounds', {
                windowId,
                bounds: { width: 1280, height: 800 },
            });
            await windowSession.detach();
            await seed.select('[name="pr-grouping"]', 'repository');
            await expect
                .poll(
                    async () =>
                        (await readAppData(seed)).preferences?.grouping?.mode
                )
                .toBe('repository');
            await seed.close();
            const browser = getBrowser();
            const targetPromise = browser.waitForTarget(
                (target) =>
                    target.type() === 'page' &&
                    target.url() ===
                        `chrome-extension://${getExtensionId()}/popup.html`
            );
            const worker = await browser.waitForTarget(
                (target) => target.type() === 'service_worker'
            );
            await (await worker.worker())!.evaluate(() =>
                chrome.action.openPopup()
            );
            const page = await (await targetPromise).asPage();
            pages.push(page);
            await page.waitForSelector('[data-repository-group]');
            expect(await page.$$('[data-repository-group]')).toHaveLength(2);
            const geometry = await page.evaluate(() => ({
                viewport: window.innerWidth,
                overflow: [
                    ...document.querySelectorAll(
                        '[data-repository-group], .repository-group-toggle'
                    ),
                ].some(
                    (element) =>
                        element.scrollWidth > element.clientWidth + 1 ||
                        element.getBoundingClientRect().right >
                            window.innerWidth
                ),
            }));
            expect(geometry.viewport).toBeGreaterThanOrEqual(750);
            expect(geometry.viewport).toBeLessThanOrEqual(800);
            expect(geometry.overflow).toBe(false);
            expect(
                await page.$$eval('.repository-group-toggle', (buttons) =>
                    buttons.every((button) => {
                        const name = button
                            .querySelector('span')!
                            .getBoundingClientRect();
                        const target = button.getBoundingClientRect();
                        return (
                            name.top >= target.top &&
                            name.bottom <= target.bottom
                        );
                    })
                )
            ).toBe(true);
            const toolbar = await page.evaluate(() => {
                const summary = document.querySelector(
                    '[data-testid="grouping-summary"]'
                )!;
                const select = document.querySelector<HTMLSelectElement>(
                    '[name="pr-grouping"]'
                )!;
                const bulk = document.querySelector(
                    '.grouping-controls button'
                )!;
                const heading = document.querySelector(
                    '.repository-group-toggle'
                )!;
                return {
                    summary: summary.textContent,
                    label: select.labels?.[0].textContent,
                    countLeft:
                        summary.getBoundingClientRect().right <
                        select.labels![0].getBoundingClientRect().left,
                    bulkBelow:
                        bulk.getBoundingClientRect().top >=
                        select.getBoundingClientRect().bottom,
                    bulkHeight: bulk.getBoundingClientRect().height,
                    background: getComputedStyle(heading).backgroundColor,
                    border: getComputedStyle(heading).borderTopWidth,
                };
            });
            expect(toolbar).toMatchObject({
                summary: '2 PRs in 2 repositories',
                label: 'View',
                countLeft: true,
                bulkBelow: true,
                bulkHeight: 24,
                border: '1px',
            });
            expect(toolbar.background).toBe(
                theme === 'light' ? 'rgb(243, 244, 246)' : 'rgb(33, 38, 45)'
            );
            expect(
                await page.$$eval('.repository-group-toggle', (elements) =>
                    elements.map((element) => element.getAttribute('title'))
                )
            ).toEqual(prs.map((pr) => pr.repository.full_name));
            expect(
                await page.$$eval('.pr-card-title', (elements) =>
                    elements.map((element) => element.getAttribute('title'))
                )
            ).toEqual(prs.map((pr) => pr.title));
            await page.select('[name="pr-grouping"]', 'none');
            await expect
                .poll(
                    async () =>
                        (await readAppData(page)).preferences?.grouping?.mode
                )
                .toBe('none');
            await page.waitForSelector('[data-testid="repository-groups"]', {
                hidden: true,
            });
            expect(
                await page.$eval(
                    '[data-testid="grouping-summary"]',
                    (element) => element.textContent
                )
            ).toBe('2 PRs');
            expect(await page.$$('.grouping-controls button')).toHaveLength(0);
            expect(
                await page.$$eval('.popup-repo-badge', (elements) =>
                    elements.map((element) => ({
                        title: element.getAttribute('title'),
                        visible: (element as HTMLElement).innerText,
                    }))
                )
            ).toEqual(
                prs.map((pr) => ({
                    title: pr.repository.full_name,
                    visible: repository,
                }))
            );
            const card = await page.$('.pr-card-link');
            await card!.focus();
            const accessibleCard = await page.accessibility.snapshot({
                root: card!,
            });
            expect(accessibleCard?.description).toBe(
                prs[0].repository.full_name
            );
            expect(accessibleCard?.name).toContain(prs[0].title);
            await page.screenshot({
                path: path.join(os.tmpdir(), `pr-grouping-flat-${theme}.png`),
            });
            await page.select('[name="pr-grouping"]', 'repository');
            await expect
                .poll(
                    async () =>
                        (await readAppData(page)).preferences?.grouping?.mode
                )
                .toBe('repository');
            await page.waitForSelector('.repository-group-toggle');
            await page.focus('.repository-group-toggle');
            const focus = await page.$eval(
                '.repository-group-toggle',
                (element) => getComputedStyle(element).outlineStyle
            );
            expect(focus).toBe('solid');
            await page.keyboard.press('Enter');
            await page.waitForSelector(
                '.repository-group-toggle[aria-expanded="false"]'
            );
            await page.screenshot({
                path: path.join(os.tmpdir(), `pr-grouping-${theme}.png`),
            });
        }
    );

    it('restores encrypted grouping choices after a complete browser restart and password unlock', async () => {
        const profile = await fs.mkdtemp(
            path.join(os.tmpdir(), 'pr-tracker-grouping-profile-')
        );
        let restarted: Browser | undefined;
        const launch = async () => {
            restarted = await puppeteer.launch({
                ...puppeteerConfig.launch,
                userDataDir: profile,
            });
            const target = await restarted.waitForTarget(
                (candidate) =>
                    candidate.type() === 'service_worker' &&
                    candidate.url().startsWith('chrome-extension://')
            );
            const worker = (await target.worker())!;
            await worker.evaluate(
                (prs) => {
                    globalThis.fetch = async (input) => {
                        const url = String(input);
                        const pr = prs[0];
                        const body = url.endsWith('/user')
                            ? { login: 'fixture-user' }
                            : url.includes('/search/issues')
                              ? {
                                    total_count: 1,
                                    incomplete_results: false,
                                    items: [
                                        {
                                            pull_request: {
                                                url: 'https://api.github.com/repos/acme/auth-service/pulls/101',
                                            },
                                        },
                                    ],
                                }
                              : url.includes('/reviews?')
                                ? []
                                : url.includes('/check-runs?')
                                  ? { total_count: 0, check_runs: [] }
                                  : url.endsWith('/status')
                                    ? {
                                          total_count: 0,
                                          statuses: [],
                                          state: 'pending',
                                      }
                                    : {
                                          ...pr,
                                          user: pr.author,
                                          base: {
                                              repo: {
                                                  name: 'auth-service',
                                                  full_name:
                                                      'acme/auth-service',
                                                  url: 'https://api.github.com/repos/acme/auth-service',
                                              },
                                          },
                                          head: { sha: 'restart' },
                                      };
                        return new Response(JSON.stringify(body), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' },
                        });
                    };
                },
                [POPULATED_PRS[0]]
            );
            const page = await restarted.newPage();
            const origin = target
                .url()
                .match(/^chrome-extension:\/\/[^/]+/)![0];
            await page.goto(`${origin}/popup.html`, {
                waitUntil: 'domcontentloaded',
            });
            return page;
        };
        try {
            const first = await launch();
            const data = appData([POPULATED_PRS[0]]);
            data.preferences!.grouping = {
                mode: 'repository',
                collapsedRepositories: ['acme/auth-service'],
            };
            await seedEncryptedState(first, { data });
            await first.reload({ waitUntil: 'domcontentloaded' });
            await first.waitForSelector(
                `${toggle('acme/auth-service')}[aria-expanded="false"]`
            );
            await restarted!.close();
            restarted = undefined;
            const second = await launch();
            await waitForText(second, 'h2', 'Enter Password');
            await second.type('#currentPassword', TEST_PASSWORD);
            await second.click('[aria-label="Sign In"]');
            await second.waitForSelector(
                `${toggle('acme/auth-service')}[aria-expanded="false"]`
            );
            expect((await readAppData(second)).preferences?.grouping).toEqual({
                mode: 'repository',
                collapsedRepositories: ['acme/auth-service'],
            });
        } finally {
            await restarted?.close();
            await removeTestProfile(profile);
        }
    });

    it.each([
        [5, 2],
        [40, 8],
        [100, 20],
        [200, 30],
        [100, 1],
    ])(
        'renders all %i PRs across %i repositories and measures grouping interactions',
        async (count, repositories) => {
            const prs = groupingFixture(count, repositories);
            const page = await openSeededPopup(github, { data: appData(prs) });
            pages.push(page);
            await page.setViewport({ width: 750, height: 600 });
            const started = performance.now();
            await page.select('[name="pr-grouping"]', 'repository');
            await page.waitForFunction(
                (expected) =>
                    document.querySelectorAll('[data-repository-group]')
                        .length === expected,
                {},
                repositories
            );
            const groupWallMs = performance.now() - started;
            expect(await page.$$(cards)).toHaveLength(count);
            const elementCount = await page.$eval(
                '[data-testid="repository-groups"]',
                (root) => root.querySelectorAll('*').length
            );
            const collapseStarted = performance.now();
            await page.evaluate(() =>
                Array.from(document.querySelectorAll('button'))
                    .find((button) => button.textContent === 'Collapse all')!
                    .click()
            );
            await page.waitForFunction(
                () => document.querySelectorAll('.pr-card-accent').length === 0
            );
            const collapseWallMs = performance.now() - collapseStarted;
            const collapsedElements = await page.$eval(
                '[data-testid="repository-groups"]',
                (root) => root.querySelectorAll('*').length
            );
            const expandStarted = performance.now();
            await page.evaluate(() =>
                Array.from(document.querySelectorAll('button'))
                    .find((button) => button.textContent === 'Expand all')!
                    .click()
            );
            await page.waitForFunction(
                (expected) =>
                    document.querySelectorAll('.pr-card-accent').length ===
                    expected,
                {},
                count
            );
            const expandWallMs = performance.now() - expandStarted;
            const browserFrameMs = await page.evaluate(async () => {
                const action = async (label: string) => {
                    const started = performance.now();
                    Array.from(document.querySelectorAll('button'))
                        .find((button) => button.textContent === label)!
                        .click();
                    await new Promise<void>((resolve) =>
                        requestAnimationFrame(() =>
                            requestAnimationFrame(() => resolve())
                        )
                    );
                    return performance.now() - started;
                };
                return {
                    collapse: await action('Collapse all'),
                    expand: await action('Expand all'),
                };
            });
            const searchStarted = performance.now();
            await page.type(
                '[aria-label="Search Pull Requests"]',
                `PR ${count - 1}:`
            );
            await page.waitForFunction(
                () => document.querySelectorAll('.pr-card-accent').length === 1
            );
            const searchWallMs = performance.now() - searchStarted;
            console.info(
                'GROUPING_MEASUREMENT',
                JSON.stringify({
                    count,
                    repositories,
                    elementCount,
                    collapsedElements,
                    groupWallMs,
                    collapseWallMs,
                    expandWallMs,
                    searchWallMs,
                    browserFrameMs,
                    browser: await getBrowser().version(),
                    headless: process.env.CI === 'true',
                })
            );
        }
    );
});
