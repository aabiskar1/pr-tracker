import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import puppeteer, { type Browser, type Page, TimeoutError } from 'puppeteer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { responseFor, seedEncryptedState } from '../e2e/harness';
import { appData } from '../e2e/fixtures';
import {
    assertStatusContrast,
    measureStatusContrast,
    STATUS_PRS,
} from '../helpers/statusContrast';

let browser: Browser;
let page: Page;
const uuid = '7ae712cf-0000-4000-8000-000000000113';
const extensionId = '{dabd690e-283a-4c0a-98de-3fc963365d13}';
vi.mock('../e2e/setup.js', () => ({
    getBrowser: () => browser,
    getExtensionId: () => uuid,
}));
const prs = STATUS_PRS;

async function open() {
    const popup = await browser.newPage();
    try {
        await popup.goto(`moz-extension://${uuid}/popup.html`, {
            waitUntil: 'domcontentloaded',
            timeout: 3000,
        });
    } catch (error) {
        if (!(error instanceof TimeoutError)) throw error;
    }
    await popup.waitForSelector('h1, h2');
    return popup;
}

type Connection = {
    send: (
        method: string,
        params: Record<string, unknown>
    ) => Promise<{
        result: { result: { value: string }; contexts: { context: string }[] };
    }>;
};
let connection: Connection;
let context: string;
async function evaluateChrome(expression: string) {
    return (
        await connection.send('script.evaluate', {
            expression,
            target: { context },
            awaitPromise: true,
        })
    ).result.result.value;
}
async function inToolbar<T>(script: string): Promise<T> {
    const value = await evaluateChrome(`new Promise(resolve => {
        const manager = document.querySelector('#customizationui-widget-panel browser').messageManager;
        const listener = message => { manager.removeMessageListener('contrast-result', listener); resolve(JSON.stringify(message.data)); };
        manager.addMessageListener('contrast-result', listener);
        manager.loadFrameScript('data:application/javascript,' + encodeURIComponent(${JSON.stringify(`const popup = content.document; try { ${script} } catch (error) { sendAsyncMessage('contrast-result', { frameError: String(error) }); }`)}), false);
    })`);
    const result = JSON.parse(value);
    if (result?.frameError) throw new Error(result.frameError);
    return result as T;
}
async function openToolbar() {
    await evaluateChrome(
        'document.getElementById("unified-extensions-button").click(); true'
    );
    await vi.waitFor(async () =>
        expect(
            await evaluateChrome(
                'document.getElementById("unified-extensions-panel").state'
            )
        ).toBe('open')
    );
    await evaluateChrome(
        'document.querySelector(\'.webextension-browser-action[label="PR Tracker"]\').click(); true'
    );
    await vi.waitFor(async () =>
        expect(
            await evaluateChrome(
                'document.getElementById("customizationui-widget-panel").state'
            )
        ).toBe('open')
    );
    await vi.waitFor(async () =>
        expect(
            await inToolbar<number>(
                'sendAsyncMessage("contrast-result", popup.querySelectorAll(".pr-card-accent").length);'
            )
        ).toBe(6)
    );
}

beforeAll(async () => {
    browser = await puppeteer.launch({
        browser: 'firefox',
        executablePath:
            process.env.FIREFOX_PATH ??
            'C:/Program Files/Mozilla Firefox/firefox.exe',
        headless: false,
        env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
        extraPrefsFirefox: {
            'extensions.webextensions.uuids': JSON.stringify({
                [extensionId]: uuid,
            }),
        },
    });
    connection = (browser as unknown as { connection: Connection }).connection;
    await browser.installExtension(path.resolve('.output/firefox-mv2'));
    page = await open();
    await page.exposeFunction('contrastResponse', (url: string) =>
        responseFor(url, { pullRequests: prs })
    );
    await page.evaluate(async () => {
        const api = (
            globalThis as typeof globalThis & { browser: typeof chrome }
        ).browser;
        const background = (await api.runtime.getBackgroundPage()) as Window &
            typeof globalThis;
        const response = (
            globalThis as typeof globalThis & {
                contrastResponse: (
                    url: string
                ) => Promise<{ status: number; body: unknown }>;
            }
        ).contrastResponse;
        background.fetch = async (input) => {
            const result = await response(String(input));
            return new background.Response(JSON.stringify(result.body), {
                status: result.status,
                headers: { 'Content-Type': 'application/json' },
            });
        };
    });
    // Keep the fixture bridge page alive while toolbar panels close and reopen.
    const tree = await connection.send('browsingContext.getTree', {
        'moz:scope': 'chrome',
    });
    context = tree.result.contexts[0].context;
}, 30000);
afterAll(async () => {
    await browser?.close();
});

async function captureToolbar(name: string) {
    const scrollY = await inToolbar<number>(
        'sendAsyncMessage("contrast-result", content.scrollY);'
    );
    const screenshot = await evaluateChrome(`(async () => {
        const panel = document.querySelector('#customizationui-widget-panel browser');
        const bitmap = await panel.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0, ${scrollY}, panel.clientWidth, panel.clientHeight), 1, 'white');
        const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); return canvas.toDataURL();
    })()`);
    await fs.writeFile(
        path.join(os.tmpdir(), name),
        Buffer.from(screenshot.split(',')[1], 'base64')
    );
}

it.each(['light', 'dark'] as const)(
    'keeps status/filter text and icons readable in the real Firefox MV2 toolbar popup in %s',
    async (theme) => {
        await seedEncryptedState(page, { data: appData(prs), theme });
        await openToolbar();
        try {
            await inToolbar(
                'popup.querySelector(\'[aria-label="Advanced CI filters"]\').click(); sendAsyncMessage("contrast-result", true);'
            );
            await vi.waitFor(async () =>
                expect(
                    await inToolbar<boolean>(
                        'sendAsyncMessage("contrast-result", !!popup.querySelector(".ci-advanced-dropdown"));'
                    )
                ).toBe(true)
            );
            const audit = await inToolbar<
                ReturnType<typeof measureStatusContrast>
            >(
                `sendAsyncMessage('contrast-result', (${measureStatusContrast.toString()})(popup));`
            );
            assertStatusContrast(audit);
            expect(
                audit.rows.filter((row) => row.state === 'pending')
            ).toHaveLength(7);
            await fs.writeFile(
                path.join(os.tmpdir(), `pr-contrast-firefox-${theme}.json`),
                JSON.stringify(
                    { version: await browser.version(), audit },
                    null,
                    2
                )
            );
            await captureToolbar(`pr-contrast-firefox-${theme}.png`);
            await inToolbar(
                'popup.querySelector(\'[aria-label="Advanced CI filters"]\').click(); content.scrollTo(0, popup.documentElement.scrollHeight); content.requestAnimationFrame(() => content.requestAnimationFrame(() => sendAsyncMessage("contrast-result", true)));'
            );
            expect(
                await inToolbar<number>(
                    'sendAsyncMessage("contrast-result", content.scrollY);'
                )
            ).toBeGreaterThan(0);
            await captureToolbar(`pr-contrast-firefox-${theme}-bottom.png`);
            // Firefox's inspector locks the actual CSS hover state in this frame.
            expect(
                await inToolbar(
                    'content.scrollTo(0, 0); const label = popup.querySelector(\'label[title="Show pending checks"]\'); InspectorUtils.addPseudoClassLock(label, ":hover"); sendAsyncMessage("contrast-result", label.matches(":hover"));'
                )
            ).toBe(true);
            assertStatusContrast(
                await inToolbar<ReturnType<typeof measureStatusContrast>>(
                    `sendAsyncMessage('contrast-result', (${measureStatusContrast.toString()})(popup));`
                )
            );
            await inToolbar(
                'popup.querySelector(\'label[title="Show pending checks"] input\').focus(); sendAsyncMessage("contrast-result", true);'
            );
            const focused = await inToolbar<
                ReturnType<typeof measureStatusContrast>
            >(
                `sendAsyncMessage('contrast-result', (${measureStatusContrast.toString()})(popup));`
            );
            expect(focused.focus).toMatchObject({
                visible: true,
                style: 'solid',
                width: '2px',
            });
            expect(focused.focus!.contrast).toBeGreaterThanOrEqual(3);
            await captureToolbar(`pr-contrast-firefox-${theme}-focus.png`);
            await inToolbar(
                'popup.querySelector(\'label[title="Show pending checks"] input\').click(); sendAsyncMessage("contrast-result", true);'
            );
            await vi.waitFor(async () =>
                expect(
                    await inToolbar<string>(
                        'sendAsyncMessage("contrast-result", popup.querySelector(\'label[title="Show pending checks"] [data-slot="badge"]\').dataset.selected);'
                    )
                ).toBe('false')
            );
            assertStatusContrast(
                await inToolbar<ReturnType<typeof measureStatusContrast>>(
                    `sendAsyncMessage('contrast-result', (${measureStatusContrast.toString()})(popup));`
                )
            );
        } finally {
            await evaluateChrome(
                'document.getElementById("customizationui-widget-panel").hidePopup(); true'
            );
            await page.evaluate(() =>
                (
                    globalThis as typeof globalThis & { browser: typeof chrome }
                ).browser.runtime.sendMessage({ type: 'CLEAR_SESSION' })
            );
        }
    }
);
