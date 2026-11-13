import { afterAll, beforeAll, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { getBrowser, getExtensionId } from './setup';
import {
    installGitHubApiMock,
    openSeededPopup,
    type GitHubMock,
} from './harness';
import { appData } from './fixtures';
import {
    assertStatusContrast,
    measureStatusContrast,
    STATUS_PRS,
} from '../helpers/statusContrast';

let github: GitHubMock;
beforeAll(async () => {
    github = await installGitHubApiMock();
});
afterAll(async () => {
    await github.close();
});

it.each(['light', 'dark'] as const)(
    'checks status colours, the Pending contrast exception, hover and focus in the native Chrome popup in %s',
    async (theme) => {
        github.setScenario({ pullRequests: STATUS_PRS });
        const seed = await openSeededPopup(github, {
            data: appData(STATUS_PRS),
            theme,
        });
        const session = await seed.createCDPSession();
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { width: 1280, height: 900 },
        });
        await session.detach();
        await seed.close();
        const browser = getBrowser();
        const target = browser.waitForTarget(
            (t) =>
                t.type() === 'page' &&
                t.url() === `chrome-extension://${getExtensionId()}/popup.html`
        );
        const worker = await browser.waitForTarget(
            (t) => t.type() === 'service_worker'
        );
        await (await worker.worker())!.evaluate(() =>
            chrome.action.openPopup()
        );
        const popup = await (await target).asPage();
        try {
            await popup.waitForFunction(
                () => document.querySelectorAll('.pr-card-accent').length === 6
            );
            await popup.click('[aria-label="Advanced CI filters"]');
            await popup.waitForSelector('.ci-advanced-dropdown');
            const audit = await popup.evaluate(measureStatusContrast);
            assertStatusContrast(audit);
            expect(
                new Set(
                    audit.rows
                        .filter((r) => r.context === 'filter')
                        .map((r) => r.state)
                )
            ).toEqual(
                new Set([
                    'passing',
                    'failing',
                    'pending',
                    'approved',
                    'changes-requested',
                    'checkmark',
                    'No CI',
                    'Unknown',
                ])
            );
            await fs.writeFile(
                path.join(os.tmpdir(), `pr-contrast-chrome-${theme}.json`),
                JSON.stringify(
                    { version: await browser.version(), audit },
                    null,
                    2
                )
            );
            await popup.screenshot({
                path: path.join(os.tmpdir(), `pr-contrast-chrome-${theme}.png`),
            });
            await popup.keyboard.press('Escape');
            await popup.evaluate(() =>
                window.scrollTo(0, document.documentElement.scrollHeight)
            );
            await popup.screenshot({
                path: path.join(
                    os.tmpdir(),
                    `pr-contrast-chrome-${theme}-bottom.png`
                ),
            });
            await popup.evaluate(() => window.scrollTo(0, 0));
            const label = 'label[title="Show pending checks"]';
            await popup.hover(label);
            assertStatusContrast(await popup.evaluate(measureStatusContrast));
            // A real keyboard step makes :focus-visible apply to the hidden input.
            await popup.focus(`${label} input`);
            await popup.keyboard.press('Tab');
            await popup.keyboard.down('Shift');
            await popup.keyboard.press('Tab');
            await popup.keyboard.up('Shift');
            const focused = await popup.evaluate(measureStatusContrast);
            expect(focused.focus).toMatchObject({
                visible: true,
                style: 'solid',
                width: '2px',
            });
            expect(focused.focus!.contrast).toBeGreaterThanOrEqual(3);
            await popup.screenshot({
                path: path.join(
                    os.tmpdir(),
                    `pr-contrast-chrome-${theme}-focus.png`
                ),
            });
            // Deselection changes the presentation only; the remaining chips stay readable.
            await popup.keyboard.press('Space');
            await popup.waitForSelector(`${label} [data-selected="false"]`);
            assertStatusContrast(await popup.evaluate(measureStatusContrast));
        } finally {
            await popup.evaluate(() =>
                chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' })
            );
            await popup.close();
        }
    }
);
