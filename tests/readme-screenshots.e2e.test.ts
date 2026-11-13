// Opt-in capture: see docs/screenshots.md. No real GitHub credentials are used.
import { it } from 'vitest';
import { installGitHubApiMock, openSeededPopup } from './e2e/harness';
import {
    captureDemoScenes,
    demoData,
    prepareDemo,
} from './helpers/screenshotDemo';

it.each(['light', 'dark'] as const)(
    'captures deterministic README and Chrome store source images in %s',
    async (theme) => {
        const github = await installGitHubApiMock();
        try {
            const page = await openSeededPopup(github, {
                theme,
                data: demoData(),
            });
            try {
                await prepareDemo(page);
                await captureDemoScenes(page, 'chrome', theme);
            } finally {
                await page.evaluate(() =>
                    chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' })
                );
                await page.close();
            }
        } finally {
            await github.close();
        }
    },
    60000
);
