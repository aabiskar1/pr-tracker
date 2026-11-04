import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import puppeteer, { type Browser, type Page, TimeoutError } from 'puppeteer';
import path from 'node:path';
import { readAppData, responseFor, seedEncryptedState } from '../e2e/harness';
import { appData, POPULATED_PRS, TEST_PASSWORD } from '../e2e/fixtures';

let browser: Browser;
let page: Page;
let controller: Page;
const uuid = '7ae712cf-0000-4000-8000-000000000108';
const extensionId = '{dabd690e-283a-4c0a-98de-3fc963365d13}';
vi.mock('../e2e/setup.js', () => ({
    getBrowser: () => browser,
    getExtensionId: () => uuid,
}));
const pr = POPULATED_PRS[0];
let currentPr = { ...pr };
const requests: string[] = [];
const details: { conditional: boolean; status: number }[] = [];

async function open() {
    page = await browser.newPage();
    try {
        await page.goto(`moz-extension://${uuid}/popup.html`, {
            waitUntil: 'domcontentloaded',
            timeout: 3000,
        });
    } catch (error) {
        if (!(error instanceof TimeoutError)) throw error;
    }
    await page.waitForSelector('h2');
}
let lastRefresh = 0;
async function refresh() {
    // The production MV2 build has a four-second manual throttle and no test reset hook.
    await vi.waitFor(
        () => expect(Date.now() - lastRefresh).toBeGreaterThan(4000),
        { timeout: 5000, interval: 50 }
    );
    await page.evaluate(() =>
        (
            globalThis as typeof globalThis & { browser: typeof chrome }
        ).browser.runtime.sendMessage({ type: 'CHECK_PRS', manual: true })
    );
    lastRefresh = Date.now();
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
    await browser.installExtension(path.resolve('.output/firefox-mv2'));
    await open();
    controller = page;
    await controller.exposeFunction(
        'cacheFixtureResponse',
        (url: string, etag: string | null) => {
            requests.push(url);
            const conditional = etag === '"firefox-v1"';
            const response = responseFor(url, {
                pullRequests: [currentPr],
                detailEtag: '"firefox-v1"',
            });
            const status = response.etag && conditional ? 304 : response.status;
            if (response.etag) details.push({ conditional, status });
            return {
                status,
                body: status === 304 ? null : JSON.stringify(response.body),
                headers: {
                    'Content-Type': 'application/json',
                    ...(response.etag ? { ETag: response.etag } : {}),
                },
            };
        }
    );
    // Firefox BiDi does not intercept extension background traffic here. Keep
    // this controller open as the fixture bridge while the user popup closes.
    await controller.evaluate(async () => {
        const api = (
            globalThis as typeof globalThis & { browser: typeof chrome }
        ).browser;
        const background = (await api.runtime.getBackgroundPage()) as Window &
            typeof globalThis;
        const respond = (
            globalThis as typeof globalThis & {
                cacheFixtureResponse: (
                    url: string,
                    etag: string | null
                ) => Promise<{
                    status: number;
                    body: string | null;
                    headers: Record<string, string>;
                }>;
            }
        ).cacheFixtureResponse;
        background.fetch = async (input, init) => {
            const result = await respond(
                String(input),
                new Headers(init?.headers).get('if-none-match')
            );
            return new background.Response(result.body, {
                status: result.status,
                headers: result.headers,
            });
        };
    });
    await open();
    await seedEncryptedState(page, { data: appData([pr]) });
    await refresh();
}, 30000);
afterAll(async () => {
    await browser?.close();
});

it('persists encrypted details, revalidates after reopen and clears on sign-out and reset', async () => {
    const encrypted = await page.evaluate(async () => {
        const api = (
            globalThis as typeof globalThis & { browser: typeof chrome }
        ).browser;
        return (await api.storage.local.get('encryptedDetailCache'))
            .encryptedDetailCache;
    });
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain(pr.title);
    expect(details).toContainEqual({ conditional: false, status: 200 });
    await page.close();
    await open();
    // Unchanged canonical detail/SHA must not hide an independent review or CI update.
    currentPr = { ...pr, review_status: 'approved', ci_status: 'failing' };
    requests.splice(0);
    details.splice(0);
    await refresh();
    expect(details).toContainEqual({ conditional: true, status: 304 });
    expect(requests.some((url) => url.includes('/reviews?'))).toBe(true);
    expect(requests.some((url) => url.includes('/check-runs?'))).toBe(true);
    expect((await readAppData(page)).pullRequests[0]).toMatchObject({
        title: pr.title,
        review_status: 'approved',
        ci_status: 'failing',
    });
    const cleared = await page.evaluate(async () => {
        const api = (
            globalThis as typeof globalThis & { browser: typeof chrome }
        ).browser;
        await api.runtime.sendMessage({ type: 'CLEAR_SESSION' });
        const stored = await api.storage.local.get(null);
        return {
            cache: stored.encryptedDetailCache,
            iv: stored.detailCacheIv,
            tokenPresent: Array.isArray(stored.encryptedGithubToken),
        };
    });
    expect(cleared).toEqual({ tokenPresent: true });
    await page.evaluate(
        (password) =>
            (
                globalThis as typeof globalThis & { browser: typeof chrome }
            ).browser.runtime.sendMessage({
                type: 'SET_PASSWORD',
                password,
                remember: true,
            }),
        TEST_PASSWORD
    );
    await refresh();
    expect(
        await page.evaluate(
            async () =>
                typeof (
                    await (
                        globalThis as typeof globalThis & {
                            browser: typeof chrome;
                        }
                    ).browser.storage.local.get('encryptedDetailCache')
                ).encryptedDetailCache
        )
    ).toBe('string');
    await page.evaluate(() =>
        (
            globalThis as typeof globalThis & { browser: typeof chrome }
        ).browser.runtime.sendMessage({ type: 'RESET_ACCOUNT' })
    );
    expect(
        await page.evaluate(async () => {
            const stored = await (
                globalThis as typeof globalThis & { browser: typeof chrome }
            ).browser.storage.local.get(null);
            return [
                'encryptedDetailCache',
                'detailCacheIv',
                'encryptedGithubToken',
                'encryptedAppData',
            ].filter((key) => key in stored);
        })
    ).toEqual([]);
    console.info('CACHE_FIREFOX_RUNTIME', await browser.version());
}, 30000);
