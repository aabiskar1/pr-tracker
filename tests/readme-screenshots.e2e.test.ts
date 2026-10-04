// After npm run build:e2e, capture with:
// node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts tests/readme-screenshots.e2e.test.ts
import { expect, it } from 'vitest';
import {
    installGitHubApiMock,
    openSeededPopup,
    readAppData,
    waitForText,
    writeAppData,
} from './e2e/harness.js';
import { appData, FIXED_UPDATED_AT, POPULATED_PRS } from './e2e/fixtures.js';

const demoPullRequests = [
    { ...POPULATED_PRS[0], created_at: '2026-01-15T00:00:00.000Z' },
    {
        ...POPULATED_PRS[1],
        created_at: '2026-01-13T12:00:00.000Z',
        requested_reviewers: POPULATED_PRS[1].requested_reviewers.slice(0, 3),
    },
    { ...POPULATED_PRS[2], created_at: '2026-01-10T12:00:00.000Z' },
];

it.each(['light', 'dark'] as const)(
    'captures deterministic README screenshots in %s',
    async (theme) => {
        const github = await installGitHubApiMock();
        const data = appData(demoPullRequests);
        try {
            const page = await openSeededPopup(github, { theme, data });
            try {
                await page.setViewport({ width: 750, height: 600 });
                // Wait for startup refresh before restoring the exact demo statuses.
                await expect
                    .poll(async () => (await readAppData(page)).lastUpdated)
                    .not.toBe(FIXED_UPDATED_AT);
                // Freeze relative age/freshness labels without changing production code.
                await page.evaluate((timestamp) => {
                    Date.now = () => Date.parse(timestamp);
                }, FIXED_UPDATED_AT);
                await writeAppData(page, {
                    ...data,
                    lastSuccessfulRefreshAt: FIXED_UPDATED_AT,
                });
                await waitForText(
                    page,
                    '[data-testid="last-checked"]',
                    'Checked just now'
                );
                await waitForText(page, 'li', '12h ago');
                await page.waitForSelector('[data-ci-status="failing"]');
                await page.evaluate(async () => {
                    await document.fonts.ready;
                    await Promise.all(
                        Array.from(document.images).map((image) =>
                            image.decode()
                        )
                    );
                });
                expect(await page.$$('li')).toHaveLength(3);
                expect(
                    await page.$eval('header h2', (title) =>
                        title.textContent?.trim()
                    )
                ).toBe('PR Tracker');
                expect(
                    await page.$eval(
                        'header',
                        (header) => header.getBoundingClientRect().height
                    )
                ).toBe(28);
                await page.screenshot({
                    path: `docs/assets/readme/dashboard-${theme}.png`,
                });
                if (theme === 'dark') {
                    await page.click('[aria-label="Settings"]');
                    await page.waitForSelector(
                        '[role="dialog"][aria-label="Settings"]'
                    );
                    await page.screenshot({
                        path: 'docs/assets/readme/settings-dark.png',
                    });
                }
            } finally {
                await page.close();
            }
        } finally {
            await github.close();
        }
    }
);
