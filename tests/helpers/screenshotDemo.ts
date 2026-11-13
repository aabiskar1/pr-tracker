import { expect } from 'vitest';
import type { Page } from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { PullRequest } from '../../src/types';
import { appData, FIXED_UPDATED_AT } from '../e2e/fixtures';
import { readAppData, waitForText, writeAppData } from '../e2e/harness';

export const DEMO_NOW = '2026-11-13T12:00:00.000Z';
const hoursAgo = (hours: number) =>
    new Date(Date.parse(DEMO_NOW) - hours * 3600000).toISOString();
const person = (name: string, colour: string) => ({
    login: `demo-${name}`,
    avatar_url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="12" fill="${colour}"/><text x="12" y="16" text-anchor="middle" font-family="sans-serif" font-size="12" fill="white">${name[0].toUpperCase()}</text></svg>`)}`,
});
const people = [
    person('alex', '#5046e4'),
    person('morgan', '#0969da'),
    person('riley', '#8250df'),
];
const repos = ['api-gateway', 'web-dashboard', 'ui-library'];
const titles = [
    'Add retry handling for webhook deliveries',
    'Reduce dashboard cold-start time',
    'Improve keyboard focus in the settings panel',
    'Add pagination to the audit log',
    'Handle empty repository search results',
    'Document component spacing tokens',
];
export const DEMO_PRS: PullRequest[] = titles.map((title, i) => ({
    id: 401 + i,
    title,
    html_url: `https://github.com/demo-workspace/${repos[i % 3]}/pull/${401 + i}`,
    repository: {
        name: repos[i % 3],
        full_name: `demo-workspace/${repos[i % 3]}`,
    },
    state: 'open',
    draft: i === 5,
    created_at: hoursAgo(12 + i * 24),
    updated_at: hoursAgo((i % 3) + 1),
    author: people[i % 3],
    requested_reviewers:
        i === 3 ? [] : [people[(i + 1) % 3], ...(i === 0 ? [people[2]] : [])],
    review_status: (
        [
            'pending',
            'approved',
            'changes-requested',
            'approved',
            'pending',
            'pending',
        ] as const
    )[i],
    ci_status: (
        [
            'passing',
            'failing',
            'pending',
            'no-ci',
            'unknown',
            'passing',
        ] as const
    )[i],
}));
export const demoData = () => ({
    ...appData(DEMO_PRS),
    lastSuccessfulRefreshAt: DEMO_NOW,
});

export async function prepareDemo(page: Page) {
    await expect
        .poll(async () => (await readAppData(page)).lastUpdated)
        .not.toBe(FIXED_UPDATED_AT);
    await page.evaluate((timestamp) => {
        Date.now = () => Date.parse(timestamp);
    }, DEMO_NOW);
    await writeAppData(page, demoData());
    await waitForText(page, '[data-testid="last-checked"]', 'Checked just now');
    await waitForText(page, 'li', '12h ago');
}

export async function captureDemoScenes(
    page: Page,
    browser: 'chrome' | 'firefox',
    theme: 'light' | 'dark'
) {
    const readme = path.resolve('docs/assets/readme');
    const raw = path.resolve(`docs/assets/stores/${browser}/source`);
    await fs.mkdir(readme, { recursive: true });
    await fs.mkdir(raw, { recursive: true });
    await fs.writeFile(
        path.join(raw, 'capture.json'),
        JSON.stringify(
            {
                browser: await page.browser().version(),
                node: process.version,
                platform: process.platform,
                osRelease: os.release(),
                sceneClock: DEMO_NOW,
                viewport: { width: 750, height: 640, deviceScaleFactor: 2 },
            },
            null,
            4
        ) + '\n'
    );
    if (browser === 'chrome')
        await page.emulateMediaFeatures([
            { name: 'prefers-reduced-motion', value: 'reduce' },
        ]);
    const capture = async (scene: string, readmeName?: string) => {
        if (browser === 'chrome')
            await page.setViewport({
                width: 750,
                height: 640,
                deviceScaleFactor: 2,
            });
        await page.mouse.move(740, 590);
        await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(
                [...document.images].map((image) => image.decode())
            );
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve())
                )
            );
        });
        expect(
            await page.$eval('html', (element) => element.scrollWidth)
        ).toBeLessThanOrEqual(750);
        expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
        expect(
            await page.$eval(
                '.pr-card-accent [data-review-status="pending"], .filter-bar-container [data-review-status="pending"][data-selected="true"]',
                (element) => getComputedStyle(element).backgroundColor
            )
        ).toBe('rgb(201, 157, 8)');
        await page.screenshot({
            path: path.join(raw, `${scene}-${theme}.png`),
        });
        if (browser === 'chrome' && readmeName) {
            await page.screenshot({
                path: path.join(readme, readmeName),
                clip: { x: 0, y: 0, width: 750, height: 600 },
            });
        }
    };

    if (browser === 'chrome')
        await page.setViewport({
            width: 750,
            height: 640,
            deviceScaleFactor: 2,
        });
    await page.select('[name="pr-grouping"]', 'none');
    await waitForText(page, '[data-testid="grouping-summary"]', '6 PRs');
    expect(await page.$$('.pr-card-accent')).toHaveLength(6);
    expect(
        await page.$eval('.pr-card-title', (element) =>
            element.getAttribute('title')
        )
    ).toBe(titles[0]);
    expect(
        await page.$eval('.popup-repo-badge', (element) =>
            element.getAttribute('title')
        )
    ).toBe('demo-workspace/api-gateway');
    await capture('all-prs', `dashboard-${theme}.png`);

    await page.select('[name="pr-grouping"]', 'repository');
    await expect
        .poll(async () => (await readAppData(page)).preferences.grouping?.mode)
        .toBe('repository');
    await waitForText(
        page,
        '[data-testid="grouping-summary"]',
        '6 PRs in 3 repositories'
    );
    for (const repo of repos.slice(0, 2)) {
        await page.click(
            `[data-repository-group="demo-workspace/${repo}"] .repository-group-toggle`
        );
        await page.waitForSelector(
            `[data-repository-group="demo-workspace/${repo}"] [aria-expanded="false"]`
        );
        await expect
            .poll(
                async () =>
                    (await readAppData(page)).preferences.grouping
                        ?.collapsedRepositories
            )
            .toContain(`demo-workspace/${repo}`);
    }
    expect(
        await page.$$('.repository-group-toggle[aria-expanded="false"]')
    ).toHaveLength(2);
    expect(await page.$$('.pr-card-accent')).toHaveLength(2);
    await capture('repositories', `repositories-${theme}.png`);

    await page.type('[aria-label="Search Pull Requests"]', 'webhook');
    await page.click('label[title="Show failing checks"]');
    await expect
        .poll(
            async () => (await readAppData(page)).preferences.filters.ciStatus
        )
        .not.toContain('failing');
    await page.click('label[title="Show pending checks"]');
    await expect
        .poll(
            async () => (await readAppData(page)).preferences.filters.ciStatus
        )
        .not.toContain('pending');
    await waitForText(
        page,
        '[data-testid="grouping-summary"]',
        '1 PR in 1 repository'
    );
    expect(
        await page.$$('.repository-group-toggle[aria-expanded="true"]')
    ).toHaveLength(1);
    expect(await page.$$('.pr-card-accent')).toHaveLength(1);
    await capture('search', `search-${theme}.png`);

    await page.focus('[aria-label="Search Pull Requests"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.waitForFunction(
        () =>
            (
                document.querySelector(
                    '[aria-label="Search Pull Requests"]'
                ) as HTMLInputElement
            ).value === ''
    );
    await page.select('[name="pr-grouping"]', 'none');
    await expect
        .poll(async () => (await readAppData(page)).preferences.grouping?.mode)
        .toBe('none');
    await page.click('label[title="Show passing checks"]');
    await expect
        .poll(
            async () => (await readAppData(page)).preferences.filters.ciStatus
        )
        .not.toContain('passing');
    await page.click('[aria-label="Advanced CI filters"]');
    await page.waitForSelector('.ci-advanced-dropdown');
    await page.click('.ci-advanced-dropdown input[data-ci-status="unknown"]');
    await expect
        .poll(
            async () => (await readAppData(page)).preferences.filters.ciStatus
        )
        .toEqual(['no-ci']);
    await waitForText(page, '.pr-card-title', titles[3]);
    await waitForText(page, '[data-testid="grouping-summary"]', '1 PR');
    expect(await page.$$('.pr-card-accent')).toHaveLength(1);
    expect(await page.$('.pr-card-accent [data-ci-status]')).toBeNull();
    await capture('advanced', `advanced-${theme}.png`);

    if (browser === 'chrome' && theme === 'dark') {
        await page.keyboard.press('Escape');
        await page.click('[aria-label="Settings"]');
        await page.waitForSelector('[role="dialog"][aria-label="Settings"]');
        await capture('settings', 'settings-dark.png');
    }
}
