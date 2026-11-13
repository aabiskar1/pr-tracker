import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import puppeteer, { type Browser, type Page, TimeoutError } from 'puppeteer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
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
        title: `Long repository identity: ${'full exact title with "quotes" & punctuation — '.repeat(12)}`,
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
    // Keep the fixture bridge page alive while toolbar panels close and reopen.
    const tree = await connection.send('browsingContext.getTree', {
        'moz:scope': 'chrome',
    });
    context = tree.result.contexts[0].context;
}, 30000);
afterAll(async () => {
    await browser?.close();
});

it.each(['light', 'dark'] as const)(
    'groups in the real Firefox MV2 toolbar popup in %s, persists collapse and temporarily reveals search matches',
    async (theme) => {
        const data = appData(prs);
        data.preferences!.grouping = {
            mode: 'repository',
            collapsedRepositories: [],
        };
        await seedEncryptedState(page, { data, theme });
        await openToolbar();
        const initial = await inToolbar<{ names: string[]; fits: boolean }>(`
        const headers = [...popup.querySelectorAll('.repository-group-toggle')];
        sendAsyncMessage('grouping-result', { names: headers.map(header => header.textContent), fits: headers.every(header => {
            const target = header.getBoundingClientRect();
            const name = header.querySelector('span').getBoundingClientRect();
            return header.scrollWidth <= header.clientWidth && target.right <= content.innerWidth && name.top >= target.top && name.bottom <= target.bottom;
        }) });
    `);
        expect(
            initial.names.some((name) => name.includes('acme/auth-service'))
        ).toBe(true);
        expect(
            initial.names.some((name) => name.includes('other/auth-service'))
        ).toBe(true);
        expect(initial.fits).toBe(true);
        const presentation = await inToolbar<{
            theme: string;
            label: string;
            options: string[];
            summary: string;
            countLeft: boolean;
            bulkBelow: boolean;
            bulkHeight: number;
            border: string;
            background: string;
            headings: string[];
            titles: { title: string; text: string }[];
        }>(`
        const summary = popup.querySelector('[data-testid="grouping-summary"]');
        const select = popup.querySelector('[name="pr-grouping"]');
        const bulk = popup.querySelector('.grouping-controls button');
        const heading = popup.querySelector('.repository-group-toggle');
        sendAsyncMessage('grouping-result', {
            theme: popup.documentElement.dataset.theme, label: select.labels[0].textContent,
            options: [...select.options].map(option => option.text), summary: summary.textContent,
            countLeft: summary.getBoundingClientRect().right < select.labels[0].getBoundingClientRect().left,
            bulkBelow: bulk.getBoundingClientRect().top >= select.getBoundingClientRect().bottom,
            bulkHeight: bulk.getBoundingClientRect().height,
            border: content.getComputedStyle(heading).borderTopWidth,
            background: content.getComputedStyle(heading).backgroundColor,
            headings: [...popup.querySelectorAll('.repository-group-toggle')].map(button => button.title),
            titles: [...popup.querySelectorAll('.pr-card-title')].map(title => ({ title: title.title, text: title.textContent })),
        });
    `);
        expect(presentation).toMatchObject({
            theme,
            label: 'View',
            options: ['All PRs', 'By repository'],
            summary: '3 PRs in 3 repositories',
            countLeft: true,
            bulkBelow: true,
            bulkHeight: 24,
            border: '1px',
        });
        expect(presentation.background).toBe(
            theme === 'light' ? 'rgb(243, 244, 246)' : 'rgb(33, 38, 45)'
        );
        expect(presentation.headings).toEqual(
            expect.arrayContaining([
                'acme/auth-service',
                'other/auth-service',
                prs[2].repository.full_name,
            ])
        );
        expect(presentation.titles).toEqual(
            expect.arrayContaining(
                prs.map((pr) => ({ title: pr.title, text: pr.title }))
            )
        );
        await inToolbar(`
        const select = popup.querySelector('[name="pr-grouping"]');
        select.value = 'none'; select.dispatchEvent(new content.Event('change', { bubbles: true }));
        content.requestAnimationFrame(() => content.requestAnimationFrame(() => sendAsyncMessage('grouping-result', true)));
    `);
        const flat = await inToolbar<{
            badges: { title: string; text: string }[];
            descriptions: string[];
            summary: string;
            bulk: number;
        }>(`
        sendAsyncMessage('grouping-result', {
            badges: [...popup.querySelectorAll('.popup-repo-badge')].map(badge => ({ title: badge.title, text: badge.textContent })),
            descriptions: [...popup.querySelectorAll('.pr-card-link')].map(link => link.getAttribute('aria-description')),
            summary: popup.querySelector('[data-testid="grouping-summary"]').textContent,
            bulk: popup.querySelectorAll('.grouping-controls button').length,
        });
    `);
        expect(flat).toMatchObject({ summary: '3 PRs', bulk: 0 });
        expect(flat.badges).toEqual(
            expect.arrayContaining([
                { title: 'acme/auth-service', text: 'auth-service' },
                { title: 'other/auth-service', text: 'auth-service' },
                {
                    title: prs[2].repository.full_name,
                    text: prs[2].repository.name,
                },
            ])
        );
        expect(flat.descriptions).toEqual(
            expect.arrayContaining(presentation.headings)
        );
        await inToolbar(`
        const select = popup.querySelector('[name="pr-grouping"]');
        select.value = 'repository'; select.dispatchEvent(new content.Event('change', { bubbles: true }));
        content.requestAnimationFrame(() => content.requestAnimationFrame(() => sendAsyncMessage('grouping-result', true)));
    `);
        const screenshot = await evaluateChrome(`(async () => {
        const panel = document.querySelector('#customizationui-widget-panel browser');
        const bitmap = await panel.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0, 0, panel.clientWidth, panel.clientHeight), 1, 'white');
        const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
        return canvas.toDataURL();
    })()`);
        await fs.writeFile(
            path.join(os.tmpdir(), `pr-grouping-firefox-${theme}.png`),
            Buffer.from(screenshot.split(',')[1], 'base64')
        );
        await inToolbar(`
        const button = popup.querySelector('[data-repository-group="acme/auth-service"] button'); button.focus(); button.click();
        content.requestAnimationFrame(() => content.requestAnimationFrame(() => sendAsyncMessage('grouping-result', { expanded: button.getAttribute('aria-expanded'), focused: popup.activeElement === button, outline: content.getComputedStyle(button).outlineStyle })));
    `).then((result) =>
            expect(result).toEqual({
                expanded: 'false',
                focused: true,
                outline: 'solid',
            })
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
            (await readAppData(page)).preferences?.grouping
                ?.collapsedRepositories
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
        await evaluateChrome(
            'document.getElementById("customizationui-widget-panel").hidePopup(); true'
        );
        console.info('GROUPING_FIREFOX_RUNTIME', await browser.version());
    },
    30000
);
