// Read-only investigation probe against the unchanged test-mode extension.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getBrowser, getExtensionId } from '../../../tests/e2e/setup';
import {
    installGitHubApiMock,
    openSeededPopup,
    readAppData,
    type GitHubMock,
} from '../../../tests/e2e/harness';
import { appData, POPULATED_PRS } from '../../../tests/e2e/fixtures';
import path from 'node:path';
import os from 'node:os';
let github: GitHubMock;
beforeAll(async () => {
    github = await installGitHubApiMock();
});
afterAll(async () => {
    await github.close();
});
it.each(['light', 'dark'] as const)(
    'records native production popup contrast in %s',
    async (theme) => {
        const prs = Array.from({ length: 200 }, (_, i) => ({
            ...POPULATED_PRS[i % 4],
            id: 2000 + i,
            title: `Investigation PR ${i}`,
            repository: {
                name: `repository-${i % 30}`,
                full_name: `Acme/repository-${i % 30}`,
            },
            html_url: `https://github.com/Acme/repository-${i % 30}/pull/${2000 + i}`,
        }));
        const seed = await openSeededPopup(github, {
            data: appData(prs),
            theme,
        });
        const session = await seed.createCDPSession();
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { width: 1280, height: 900 },
        });
        await session.detach();
        await seed.select('[name="pr-grouping"]', 'repository');
        await expect
            .poll(
                async () =>
                    (await readAppData(seed)).preferences?.grouping?.mode
            )
            .toBe('repository');
        await seed.close();
        const browser = getBrowser();
        const target = browser.waitForTarget(
            (target) =>
                target.type() === 'page' &&
                target.url() ===
                    `chrome-extension://${getExtensionId()}/popup.html`
        );
        const worker = await (
            await browser.waitForTarget(
                (target) => target.type() === 'service_worker'
            )
        ).worker();
        await worker!.evaluate(() => chrome.action.openPopup());
        const page = await (await target).asPage();
        try {
            await page.waitForFunction(
                () =>
                    document.querySelectorAll('.pr-card-accent').length === 200
            );
            await page.evaluate(
                () => new Promise((resolve) => setTimeout(resolve, 400))
            );
            const colours = await page.evaluate(() => {
                const luminance = (colour: string) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = 1;
                    const c = canvas.getContext('2d')!;
                    c.fillStyle = colour;
                    c.fillRect(0, 0, 1, 1);
                    const rgb = [...c.getImageData(0, 0, 1, 1).data]
                        .slice(0, 3)
                        .map((n) => {
                            const v = n / 255;
                            return v <= 0.04045
                                ? v / 12.92
                                : ((v + 0.055) / 1.055) ** 2.4;
                        });
                    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
                };
                return [
                    ...document.querySelectorAll(
                        '[data-ci-status],[data-review-status]'
                    ),
                ]
                    .slice(0, 14)
                    .map((b) => {
                        const s = getComputedStyle(b),
                            a = luminance(s.color),
                            z = luminance(s.backgroundColor);
                        return {
                            text: b.textContent,
                            label: b.getAttribute('aria-label'),
                            foreground: s.color,
                            background: s.backgroundColor,
                            ratio:
                                (Math.max(a, z) + 0.05) /
                                (Math.min(a, z) + 0.05),
                            size: s.fontSize,
                        };
                    });
            });
            console.info(
                'PRODUCTION_CONTRAST',
                JSON.stringify({ theme, colours })
            );
            const heading = await page.$('.repository-group-toggle');
            const accessible = await page.accessibility.snapshot({
                root: heading!,
            });
            expect(accessible?.role).toBe('button');
            expect(accessible?.expanded).toBe(true);
            expect(accessible?.name).toContain('Acme/repository-');
            await page.screenshot({
                path: path.join(
                    os.tmpdir(),
                    `grouping-investigation-production-${theme}.png`
                ),
            });
            expect(await page.$$('[data-repository-group]')).toHaveLength(30);
        } finally {
            await page.evaluate(() =>
                chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' })
            );
            await page.close();
        }
    },
    30000
);
