import { describe, it, beforeAll, afterAll } from 'vitest';
import { Page } from 'puppeteer';
import { openExtensionPopup, waitForElement } from './e2e/setup.js';
import dotenv from 'dotenv';
import { validateToken } from './types.js';
import { delay } from './utils';
import { injectTestData } from './test-data.js';
import path from 'path';

dotenv.config({ path: '.env.test' });

const testToken = validateToken(process.env.GITHUB_TOKEN);
const TEST_PASSWORD = '12345678';

describe('Screenshot Capture', () => {
    let popupPage: Page;

    beforeAll(async () => {
        popupPage = await openExtensionPopup();
    });

    afterAll(async () => {
        if (popupPage && !popupPage.isClosed()) {
            await popupPage.close();
        }
    });

    it('captures screenshots of populated extension in light and dark mode', async () => {
        // 1. Authenticate
        const tokenInput = await waitForElement(popupPage, '#githubToken');
        if (tokenInput) {
            await tokenInput.type(testToken);
            await popupPage.click('button[type="submit"]');
            await delay(1000);

            const newPasswordInput = await waitForElement(
                popupPage,
                '#newPassword'
            );
            await newPasswordInput?.type(TEST_PASSWORD);
            await delay(500);

            const confirmNewPasswordInput = await waitForElement(
                popupPage,
                '#confirmNewPassword'
            );
            await confirmNewPasswordInput?.type(TEST_PASSWORD);

            const rememberPasswordCheckbox = await waitForElement(
                popupPage,
                '#rememberPassword'
            );
            await rememberPasswordCheckbox?.click();

            await popupPage.click('button[type="submit"]');
            await delay(2000);
        } else {
            console.log('Already authenticated or token input not found');
        }

        // 2. Inject Test Data
        await popupPage.evaluate(
            (injectionFunction, pwd) => {
                return eval(`(${injectionFunction})`)(pwd);
            },
            injectTestData.toString(),
            TEST_PASSWORD
        );

        // 3. Refresh to show data
        const refreshButton = await waitForElement(
            popupPage,
            'button[aria-label="Refresh Pull Requests"]',
            5000
        );
        if (refreshButton) {
            await refreshButton.click();
            await delay(2000);
        }

        // 4. Wait for list to be populated
        await waitForElement(popupPage, '.space-y-3', 10000);

        // Resize viewport to ensure full width/height availability if needed
        // but rely on fullPage: true for the actual capture of scrolling content
        await popupPage.setViewport({ width: 450, height: 800 });
        await delay(1000);

        // 5. Take Light Mode Screenshot
        const lightScreenshotPath = path.resolve(
            __dirname,
            '../screenshots/extension-promo-light.png'
        );
        await popupPage.screenshot({
            path: lightScreenshotPath,
            type: 'png',
            fullPage: true,
        });
        console.log(`Light mode screenshot saved to: ${lightScreenshotPath}`);

        // 6. Toggle Theme
        // Try to find theme button (logic borrowed from e2e test)
        const themeSelectors = [
            'button[aria-label="Toggle theme"]',
            'button[title*="theme"]',
            'button[aria-label*="theme"]',
            '.theme-toggle',
            'button[class*="theme"]',
            'button svg[class*="sun"], button svg[class*="moon"]',
        ];

        let themeButton = null;
        for (const selector of themeSelectors) {
            try {
                themeButton = await popupPage.$(selector);
                if (themeButton) break;
            } catch {
                // Selector not found, continue trying others
            }
        }

        if (!themeButton) {
            // Fallback: look for button with sun/moon inside
            const allButtons = await popupPage.$$('button');
            for (const button of allButtons) {
                const innerHTML = await button.evaluate((el) => el.innerHTML);
                if (innerHTML.includes('sun') || innerHTML.includes('moon')) {
                    themeButton = button;
                    break;
                }
            }
        }

        if (themeButton) {
            await themeButton.click();
            await delay(1000); // Wait for transition

            // 7. Take Dark Mode Screenshot
            const darkScreenshotPath = path.resolve(
                __dirname,
                '../screenshots/extension-promo-dark.png'
            );
            await popupPage.screenshot({
                path: darkScreenshotPath,
                type: 'png',
                fullPage: true,
            });
            console.log(`Dark mode screenshot saved to: ${darkScreenshotPath}`);
        } else {
            console.error('Could not find theme toggle button!');
        }
    });
});
