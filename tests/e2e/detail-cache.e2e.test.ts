import { afterAll, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { getBrowser } from './setup';
import {
    installGitHubApiMock,
    openSeededPopup,
    readAppData,
    resetManualRefreshThrottle,
    type GitHubMock,
} from './harness';
import { appData, POPULATED_PRS } from './fixtures';

let page: Page;
let github: GitHubMock;
let mockClosed = false;
afterAll(async () => {
    if (!mockClosed) await github?.close();
    await page?.close();
});

it('restores encrypted details after actual MV3 worker termination', async () => {
    github = await installGitHubApiMock();
    const pr = POPULATED_PRS[0];
    page = await openSeededPopup(github, { data: appData([pr]) });
    github.setScenario({ pullRequests: [pr], detailEtag: '"restart-v1"' });
    const refresh = async () => {
        await resetManualRefreshThrottle();
        await page.evaluate(() =>
            chrome.runtime.sendMessage({ type: 'CHECK_PRS', manual: true })
        );
    };
    await refresh();
    const before = await page.evaluate(async () => ({
        cache: (await chrome.storage.local.get('encryptedDetailCache'))
            .encryptedDetailCache,
        token: (await chrome.storage.local.get('encryptedGithubToken'))
            .encryptedGithubToken,
        badge: await chrome.action.getBadgeText({}),
        notifications: await chrome.notifications.getAll(),
    }));
    expect(typeof before.cache).toBe('string');
    expect(before.badge).toBe('1');
    expect(before.notifications).toEqual({});
    expect(before.cache).not.toContain(pr.title);
    await refresh();
    expect(github.detailRequests).toContainEqual({
        ifNoneMatch: '"restart-v1"',
        status: 304,
    });
    const oldTarget = await getBrowser().waitForTarget(
        (target) => target.type() === 'service_worker'
    );
    const worker = await oldTarget.worker();
    await worker!.evaluate(() => {
        (
            globalThis as typeof globalThis & { cacheProbe?: boolean }
        ).cacheProbe = true;
    });
    const destroyed = new Promise<void>((resolve) => {
        const listener = (target: typeof oldTarget) => {
            if (target === oldTarget) {
                getBrowser().off('targetdestroyed', listener);
                resolve();
            }
        };
        getBrowser().on('targetdestroyed', listener);
    });
    await github.close();
    mockClosed = true;
    await worker!.close();
    await destroyed;
    await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'TEST_RESET_BACKGROUND_STATE' })
    );
    const restarted = await getBrowser().waitForTarget(
        (target) => target.type() === 'service_worker' && target !== oldTarget
    );
    const newWorker = (await restarted.worker())!;
    expect(
        await newWorker.evaluate(
            () =>
                (globalThis as typeof globalThis & { cacheProbe?: boolean })
                    .cacheProbe
        )
    ).toBeUndefined();
    // CDP Fetch interception misses this restarted extension's requests on the
    // installed Chrome. Stub transport only; production storage/crypto/refresh run normally.
    await newWorker.evaluate((pr) => {
        const scope = globalThis as typeof globalThis & {
            cacheRequests: {
                url: string;
                etag: string | null;
                status: number;
            }[];
        };
        scope.cacheRequests = [];
        const detailUrl = `https://api.github.com/repos/acme/${pr.repository.name}/pulls/${pr.id}`;
        scope.fetch = async (input, init) => {
            const url = String(input);
            const etag = new Headers(init?.headers).get('if-none-match');
            let body: unknown;
            let status = 200;
            if (url.endsWith('/user')) body = { login: 'fixture-user' };
            else if (url.includes('/search/issues')) {
                const authored = new URL(url).searchParams
                    .get('q')!
                    .includes('author:');
                body = {
                    total_count: authored ? 1 : 0,
                    incomplete_results: false,
                    items: authored
                        ? [{ pull_request: { url: detailUrl } }]
                        : [],
                };
            } else if (url === detailUrl && etag === '"restart-v1"')
                status = 304;
            else if (url.includes('/reviews?'))
                body = [{ user: { id: 1 }, state: 'COMMENTED' }];
            else if (url.includes('/check-runs?'))
                body = {
                    total_count: 1,
                    check_runs: [
                        { id: 1, status: 'completed', conclusion: 'success' },
                    ],
                };
            else throw new Error('Unexpected fixture request');
            scope.cacheRequests.push({ url, etag, status });
            return new Response(status === 304 ? null : JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            });
        };
    }, pr);
    await refresh();
    const requests = await newWorker.evaluate(
        () =>
            (
                globalThis as typeof globalThis & {
                    cacheRequests: {
                        url: string;
                        etag: string | null;
                        status: number;
                    }[];
                }
            ).cacheRequests
    );
    expect(requests.filter((request) => request.status === 304)).toMatchObject([
        { etag: '"restart-v1"', status: 304 },
    ]);
    expect(
        requests.filter((request) => request.url.includes('/reviews?'))
    ).toHaveLength(1);
    expect(
        requests.filter((request) => request.url.includes('/check-runs?'))
    ).toHaveLength(1);
    expect((await readAppData(page)).pullRequests[0]).toMatchObject({
        title: pr.title,
        ci_status: pr.ci_status,
        review_status: pr.review_status,
    });
    const after = await page.evaluate(async () => ({
        cache: (await chrome.storage.local.get('encryptedDetailCache'))
            .encryptedDetailCache,
        token: (await chrome.storage.local.get('encryptedGithubToken'))
            .encryptedGithubToken,
        badge: await chrome.action.getBadgeText({}),
        notifications: await chrome.notifications.getAll(),
    }));
    expect(after).toEqual(before);
    console.info('CACHE_CHROME_RUNTIME', await getBrowser().version());
});
