// Opt-in Firefox MV2 listing capture; see docs/screenshots.md.
import { afterAll, beforeAll, it, vi } from 'vitest';
import puppeteer, { type Browser, type Page, TimeoutError } from 'puppeteer';
import path from 'node:path';
import { responseFor, seedEncryptedState } from '../e2e/harness';
import {
    captureDemoScenes,
    DEMO_PRS,
    demoData,
    prepareDemo,
} from '../helpers/screenshotDemo';

let browser: Browser;
let page: Page;
const uuid = '7ae712cf-0000-4000-8000-000000000114';
vi.mock('../e2e/setup.js', () => ({
    getBrowser: () => browser,
    getExtensionId: () => uuid,
}));

beforeAll(async () => {
    browser = await puppeteer.launch({
        browser: 'firefox',
        executablePath:
            process.env.FIREFOX_PATH ??
            'C:/Program Files/Mozilla Firefox/firefox.exe',
        headless: false,
        env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
        extraPrefsFirefox: {
            'ui.prefersReducedMotion': 1,
            'extensions.webextensions.uuids': JSON.stringify({
                '{dabd690e-283a-4c0a-98de-3fc963365d13}': uuid,
            }),
        },
    });
    await browser.installExtension(path.resolve('.output/firefox-mv2'));
    page = await browser.newPage();
    try {
        await page.goto(`moz-extension://${uuid}/popup.html`, {
            waitUntil: 'domcontentloaded',
            timeout: 3000,
        });
    } catch (error) {
        if (!(error instanceof TimeoutError)) throw error;
    }
    await page.waitForSelector('h1, h2');
    await page.exposeFunction('demoResponse', (url: string) =>
        responseFor(url, { pullRequests: DEMO_PRS })
    );
    await page.evaluate(async () => {
        const api = (
            globalThis as typeof globalThis & { browser: typeof chrome }
        ).browser;
        const background = (await api.runtime.getBackgroundPage()) as Window &
            typeof globalThis;
        const respond = (
            globalThis as typeof globalThis & {
                demoResponse: (
                    url: string
                ) => Promise<{ status: number; body: unknown }>;
            }
        ).demoResponse;
        background.fetch = async (input) => {
            const response = await respond(String(input));
            return new background.Response(JSON.stringify(response.body), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        };
    });
    // Keep the fetch bridge's document alive while the screenshot page reloads.
    page = await browser.newPage();
    await page.setViewport({ width: 750, height: 640, deviceScaleFactor: 2 });
    try {
        await page.goto(`moz-extension://${uuid}/popup.html`, {
            waitUntil: 'domcontentloaded',
            timeout: 3000,
        });
    } catch (error) {
        if (!(error instanceof TimeoutError)) throw error;
    }
    await page.waitForSelector('h1, h2');
}, 30000);
afterAll(async () => {
    await browser?.close();
});

it.each(['light', 'dark'] as const)(
    'captures real Firefox store source images in %s',
    async (theme) => {
        await seedEncryptedState(page, { theme, data: demoData() });
        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 3000 });
        } catch (error) {
            if (!(error instanceof TimeoutError)) throw error;
        }
        await page.waitForSelector('.pr-card-accent');
        await prepareDemo(page);
        await captureDemoScenes(page, 'firefox', theme);
        await page.evaluate(() =>
            (
                globalThis as typeof globalThis & { browser: typeof chrome }
            ).browser.runtime.sendMessage({ type: 'CLEAR_SESSION' })
        );
    },
    60000
);
