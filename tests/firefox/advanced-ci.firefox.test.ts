import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import puppeteer, { type Browser, type Page, TimeoutError } from 'puppeteer';
import path from 'node:path';
import { seedEncryptedState } from '../e2e/harness';
import { appData } from '../e2e/fixtures';

let browser: Browser;
let page: Page;
const extensionUuid = '7ae712cf-0000-4000-8000-000000000103';
const extensionId = '{dabd690e-283a-4c0a-98de-3fc963365d13}';

vi.mock('../e2e/setup.js', () => ({
    getBrowser: () => browser,
    getExtensionId: () => extensionUuid,
    openExtensionPopup: () => {
        throw new Error('Chrome popup helper is unavailable in Firefox');
    },
}));

type Connection = {
    send: (
        method: string,
        params: Record<string, unknown>
    ) => Promise<{
        result: { result: { value: string } };
    }>;
    on: (
        event: string,
        callback: (event: {
            isBlocked: boolean;
            request: { request: string; url: string };
        }) => void
    ) => void;
};

let connection: Connection;

async function evaluateChrome(context: string, expression: string) {
    const response = await connection.send('script.evaluate', {
        expression,
        target: { context },
        awaitPromise: true,
    });
    return response.result.result.value;
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
                [extensionId]: extensionUuid,
            }),
        },
    });
    connection = (browser as unknown as { connection: Connection }).connection;
    connection.on('network.beforeRequestSent', async (event) => {
        if (!event.isBlocked) return;
        const body = event.request.url.endsWith('/user')
            ? { login: 'firefox-fixture' }
            : { total_count: 0, incomplete_results: false, items: [] };
        await connection.send('network.provideResponse', {
            request: event.request.request,
            statusCode: 200,
            headers: [
                {
                    name: 'Content-Type',
                    value: { type: 'string', value: 'application/json' },
                },
            ],
            body: {
                type: 'base64',
                value: Buffer.from(JSON.stringify(body)).toString('base64'),
            },
        });
    });
    await connection.send('network.addIntercept', {
        phases: ['beforeRequestSent'],
        urlPatterns: [
            { type: 'pattern', protocol: 'https', hostname: 'api.github.com' },
        ],
    });
    await browser.installExtension(path.resolve('.output/firefox-mv2'));
    page = await browser.newPage();
    try {
        await page.goto(`moz-extension://${extensionUuid}/popup.html`, {
            waitUntil: 'domcontentloaded',
            timeout: 3000,
        });
    } catch (error) {
        if (!(error instanceof TimeoutError)) throw error;
    }
    await page.waitForSelector('h2');
    await seedEncryptedState(page, { data: appData([]), theme: 'light' });
    try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 3000 });
    } catch (error) {
        if (!(error instanceof TimeoutError)) throw error;
    }
    await page.waitForSelector('button[aria-label="Advanced CI filters"]');
}, 30000);

afterAll(async () => {
    await browser?.close();
});

it('keeps Advanced open through Firefox toolbar popup resize events', async () => {
    const tree = await connection.send('browsingContext.getTree', {
        'moz:scope': 'chrome',
    });
    const context = (
        tree as unknown as { result: { contexts: { context: string }[] } }
    ).result.contexts[0].context;
    await evaluateChrome(
        context,
        'document.getElementById("unified-extensions-button").click(); true'
    );
    await vi.waitFor(async () => {
        expect(
            await evaluateChrome(
                context,
                'document.getElementById("unified-extensions-panel").state'
            )
        ).toBe('open');
    });
    await evaluateChrome(
        context,
        'document.querySelector(\'.webextension-browser-action[label="PR Tracker"]\').click(); true'
    );
    await vi.waitFor(async () => {
        expect(
            await evaluateChrome(
                context,
                'document.getElementById("customizationui-widget-panel").state'
            )
        ).toBe('open');
    });

    const frameScript = `
        const popup = content.document;
        const button = popup.querySelector('button[aria-label="Advanced CI filters"]');
        const events = [];
        content.addEventListener('resize', () => events.push({
            type: 'resize', viewport: [content.innerWidth, content.innerHeight]
        }));
        content.addEventListener('error', event => events.push({ type: 'error', message: event.message }));
        const viewport = [content.innerWidth, content.innerHeight];
        button.click();
        content.requestAnimationFrame(() => {
            content.dispatchEvent(new content.Event('resize'));
            content.requestAnimationFrame(() => {
            const menu = popup.querySelector('[role="dialog"][aria-label="Advanced CI filters"]');
            const rect = menu.getBoundingClientRect();
            sendAsyncMessage('advanced-ci-result', {
                events, viewport,
                open: Boolean(menu),
                popover: menu.hasAttribute('popover'),
                expanded: button.getAttribute('aria-expanded'),
                focused: popup.activeElement?.getAttribute('data-ci-status'),
                checked: Array.from(menu.querySelectorAll('input'), input => input.checked),
                visible: menu.contains(popup.elementFromPoint(
                    (rect.left + rect.right) / 2,
                    (rect.top + rect.bottom) / 2
                )),
                rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
            });
            });
        });
    `;
    const response = await evaluateChrome(
        context,
        `new Promise(resolve => {
            const manager = document.querySelector('#customizationui-widget-panel browser').messageManager;
            const listener = message => {
                manager.removeMessageListener('advanced-ci-result', listener);
                resolve(JSON.stringify(message.data));
            };
            manager.addMessageListener('advanced-ci-result', listener);
            manager.loadFrameScript('data:application/javascript,' + encodeURIComponent(${JSON.stringify(frameScript)}), false);
        })`
    );
    const result = JSON.parse(response) as {
        events: { type: string; viewport?: number[] }[];
        viewport: number[];
        open: boolean;
        popover: boolean;
        expanded: string;
        focused: string;
        checked: boolean[];
        visible: boolean;
        rect: { left: number; top: number; right: number; bottom: number };
    };
    expect(result.events).toContainEqual({
        type: 'resize',
        viewport: result.viewport,
    });
    expect(result.events.some((event) => event.type === 'error')).toBe(false);
    expect(result.open).toBe(true);
    expect(result.popover).toBe(false);
    expect(result.expanded).toBe('true');
    expect(result.focused).toBe('no-ci');
    expect(result.checked).toEqual([true, true]);
    expect(result.visible).toBe(true);
    expect(result.rect.left).toBeGreaterThanOrEqual(0);
    expect(result.rect.top).toBeGreaterThanOrEqual(0);
    expect(result.rect.right).toBeLessThanOrEqual(result.viewport[0]);
    expect(result.rect.bottom).toBeLessThanOrEqual(result.viewport[1]);

    const interactionScript = `
        const popup = content.document;
        const button = popup.querySelector('button[aria-label="Advanced CI filters"]');
        popup.querySelector('[data-ci-status="unknown"]').click();
        content.requestAnimationFrame(() => {
            const unchecked = !popup.querySelector('[data-ci-status="unknown"]').checked;
            popup.dispatchEvent(new content.KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true
            }));
            content.requestAnimationFrame(() => {
                const escaped = !popup.querySelector('[role="dialog"][aria-label="Advanced CI filters"]');
                const focusRestored = popup.activeElement === button;
                button.click();
                content.requestAnimationFrame(() => {
                    popup.body.dispatchEvent(new content.PointerEvent('pointerdown', { bubbles: true }));
                    content.requestAnimationFrame(() => sendAsyncMessage('advanced-ci-interaction', {
                        unchecked, escaped, focusRestored,
                        outsideDismissed: !popup.querySelector('[role="dialog"][aria-label="Advanced CI filters"]')
                    }));
                });
            });
        });
    `;
    const interactionResponse = await evaluateChrome(
        context,
        `new Promise(resolve => {
            const manager = document.querySelector('#customizationui-widget-panel browser').messageManager;
            const listener = message => {
                manager.removeMessageListener('advanced-ci-interaction', listener);
                resolve(JSON.stringify(message.data));
            };
            manager.addMessageListener('advanced-ci-interaction', listener);
            manager.loadFrameScript('data:application/javascript,' + encodeURIComponent(${JSON.stringify(interactionScript)}), false);
        })`
    );
    expect(JSON.parse(interactionResponse)).toEqual({
        unchecked: true,
        escaped: true,
        focusRestored: true,
        outsideDismissed: true,
    });
});
