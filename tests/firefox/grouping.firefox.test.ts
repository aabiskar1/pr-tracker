import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import puppeteer, { type Browser, type Page, TimeoutError } from 'puppeteer';
import path from 'node:path';
import { readAppData, responseFor, seedEncryptedState } from '../e2e/harness';
import { appData, POPULATED_PRS } from '../e2e/fixtures';

let browser: Browser;
let page: Page;
const uuid = '7ae712cf-0000-4000-8000-000000000111';
const extensionId = '{dabd690e-283a-4c0a-98de-3fc963365d13}';
vi.mock('../e2e/setup.js', () => ({
    getBrowser: () => browser,
    getExtensionId: () => uuid,
}));
const prs = [
    POPULATED_PRS[0],
    {
        ...POPULATED_PRS[0],
        id: 112,
        title: 'Other owner same repository',
        html_url: 'https://github.com/other/auth-service/pull/112',
    },
    {
        ...POPULATED_PRS[0],
        id: 113,
        title: 'Long repository identity',
        repository: {
            name: 'repository-'.repeat(9),
            full_name: `${'C'.repeat(39)}/${'repository-'.repeat(9)}`,
        },
        html_url: `https://github.com/${'C'.repeat(39)}/${'repository-'.repeat(9)}/pull/113`,
    },
];

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
        const listener = message => { manager.removeMessageListener('grouping-result', listener); resolve(JSON.stringify(message.data)); };
        manager.addMessageListener('grouping-result', listener);
        manager.loadFrameScript('data:application/javascript,' + encodeURIComponent(${JSON.stringify(`const popup = content.document; ${script}`)}), false);
    })`);
    return JSON.parse(value) as T;
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
                'sendAsyncMessage("grouping-result", popup.querySelectorAll("[data-repository-group]").length);'
            )
        ).toBe(3)
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
    await page.exposeFunction('groupingResponse', (url: string) =>
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
                groupingResponse: (
                    url: string
                ) => Promise<{ status: number; body: unknown }>;
            }
        ).groupingResponse;
        background.fetch = async (input) => {
            const result = await response(String(input));
            return new background.Response(JSON.stringify(result.body), {
                status: result.status,
                headers: { 'Content-Type': 'application/json' },
            });
        };
    });
    const data = appData(prs);
    data.preferences!.grouping = {
        mode: 'repository',
        collapsedRepositories: [],
    };
    await seedEncryptedState(page, { data, theme: 'dark' });
    // Keep the fixture bridge page alive while toolbar panels close and reopen.
    const tree = await connection.send('browsingContext.getTree', {
        'moz:scope': 'chrome',
    });
    context = tree.result.contexts[0].context;
}, 30000);
afterAll(async () => {
    await browser?.close();
});

it('groups independently in the real Firefox MV2 toolbar popup, persists collapse and temporarily reveals search matches', async () => {
    await openToolbar();
    const initial = await inToolbar<{ names: string[]; fits: boolean }>(`
        const headers = [...popup.querySelectorAll('.repository-group-toggle')];
        sendAsyncMessage('grouping-result', { names: headers.map(header => header.textContent), fits: headers.every(header => header.scrollWidth <= header.clientWidth && header.getBoundingClientRect().right <= content.innerWidth) });
    `);
    expect(
        initial.names.some((name) => name.includes('acme/auth-service'))
    ).toBe(true);
    expect(
        initial.names.some((name) => name.includes('other/auth-service'))
    ).toBe(true);
    expect(initial.fits).toBe(true);
    await inToolbar(`
        const button = popup.querySelector('[data-repository-group="acme/auth-service"] button'); button.focus(); button.click();
        content.requestAnimationFrame(() => content.requestAnimationFrame(() => sendAsyncMessage('grouping-result', { expanded: button.getAttribute('aria-expanded'), focused: popup.activeElement === button })));
    `).then((result) =>
        expect(result).toEqual({ expanded: 'false', focused: true })
    );
    await vi.waitFor(async () =>
        expect(
            (await readAppData(page)).preferences?.grouping
                ?.collapsedRepositories
        ).toEqual(['acme/auth-service'])
    );
    await evaluateChrome(
        'document.getElementById("customizationui-widget-panel").hidePopup(); true'
    );
    await openToolbar();
    expect(
        await inToolbar<string>(
            `sendAsyncMessage('grouping-result', popup.querySelector('[data-repository-group="acme/auth-service"] button').getAttribute('aria-expanded'));`
        )
    ).toBe('false');
    await inToolbar(`
        const input = popup.querySelector('[aria-label="Search Pull Requests"]');
        Object.getOwnPropertyDescriptor(content.HTMLInputElement.prototype, 'value').set.call(input, 'authentication');
        input.dispatchEvent(new content.Event('input', { bubbles: true }));
        content.requestAnimationFrame(() => content.requestAnimationFrame(() => sendAsyncMessage('grouping-result', true)));
    `);
    expect(
        await inToolbar<string>(
            `sendAsyncMessage('grouping-result', popup.querySelector('[data-repository-group="acme/auth-service"] button').getAttribute('aria-expanded'));`
        )
    ).toBe('true');
    expect(
        (await readAppData(page)).preferences?.grouping?.collapsedRepositories
    ).toEqual(['acme/auth-service']);
    await inToolbar(`
        const input = popup.querySelector('[aria-label="Search Pull Requests"]');
        Object.getOwnPropertyDescriptor(content.HTMLInputElement.prototype, 'value').set.call(input, '');
        input.dispatchEvent(new content.Event('input', { bubbles: true }));
        content.requestAnimationFrame(() => content.requestAnimationFrame(() => sendAsyncMessage('grouping-result', true)));
    `);
    expect(
        await inToolbar<string>(
            `sendAsyncMessage('grouping-result', popup.querySelector('[data-repository-group="acme/auth-service"] button').getAttribute('aria-expanded'));`
        )
    ).toBe('false');
    console.info('GROUPING_FIREFOX_RUNTIME', await browser.version());
}, 30000);
