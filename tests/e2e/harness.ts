import type { CDPSession, HTTPRequest, Page } from 'puppeteer';
import type { AppData, PullRequest, ThemePreference } from '../../src/types';
import { getBrowser, getExtensionId, openExtensionPopup } from '../setup.js';
import {
    appData,
    FIXED_UPDATED_AT,
    POPULATED_PRS,
    TEST_PASSWORD,
    TEST_TOKEN,
} from './fixtures.js';

type GitHubScenario = {
    pullRequests: PullRequest[];
    userStatus?: number;
    searchStatus?: number;
    detailStatusByPrId?: Record<number, number>;
};

type PausedRequest = {
    requestId: string;
    request: { url: string };
};

export type GitHubMock = {
    requests: string[];
    setScenario: (scenario: GitHubScenario) => void;
    resetRequests: () => void;
    close: () => Promise<void>;
};

const jsonBody = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64');

const prApiUrl = (pr: PullRequest) =>
    `https://api.github.com/repos/acme/${pr.repository.name}/pulls/${pr.id}`;

function responseFor(url: string, scenario: GitHubScenario) {
    if (url === 'https://api.github.com/user') {
        return {
            status: scenario.userStatus ?? 200,
            body: { login: 'fixture-user', avatar_url: 'data:,' },
        };
    }

    if (url.includes('/search/issues')) {
        const isReviewSearch =
            decodeURIComponent(url).includes('review-requested:');
        const items = isReviewSearch
            ? []
            : scenario.pullRequests.map((pr) => ({
                  pull_request: { url: prApiUrl(pr) },
              }));
        return {
            status: scenario.searchStatus ?? 200,
            body: {
                total_count: items.length,
                incomplete_results: false,
                items,
            },
        };
    }

    const pr = scenario.pullRequests.find((item) =>
        url.startsWith(prApiUrl(item))
    );
    if (!pr) return { status: 404, body: { message: 'Fixture not found' } };

    if (url.endsWith('/reviews')) {
        const state =
            pr.review_status === 'approved'
                ? 'APPROVED'
                : pr.review_status === 'changes-requested'
                  ? 'CHANGES_REQUESTED'
                  : 'COMMENTED';
        return { status: 200, body: [{ user: { id: 1 }, state }] };
    }

    if (url.includes('/check-runs')) {
        const check =
            pr.ci_status === 'passing'
                ? { status: 'completed', conclusion: 'success' }
                : pr.ci_status === 'failing'
                  ? { status: 'completed', conclusion: 'failure' }
                  : { status: 'in_progress', conclusion: null };
        return { status: 200, body: { check_runs: [check] } };
    }

    if (url === prApiUrl(pr)) {
        const detailStatus = scenario.detailStatusByPrId?.[pr.id];
        if (detailStatus) {
            return {
                status: detailStatus,
                body: { message: 'Controlled PR detail failure' },
            };
        }
        return {
            status: 200,
            body: {
                ...pr,
                user: pr.author,
                base: {
                    repo: {
                        name: pr.repository.name,
                        url: `https://api.github.com/repos/acme/${pr.repository.name}`,
                    },
                },
                head: { sha: `fixed-sha-${pr.id}` },
            },
        };
    }

    return { status: 404, body: { message: 'Fixture not found' } };
}

export async function installGitHubApiMock(
    initial: GitHubScenario = { pullRequests: POPULATED_PRS }
): Promise<GitHubMock> {
    let scenario = initial;
    const requests: string[] = [];
    const target = await getBrowser().waitForTarget(
        (candidate) =>
            candidate.type() === 'service_worker' &&
            candidate
                .url()
                .startsWith(`chrome-extension://${getExtensionId()}/`),
        { timeout: 10000 }
    );
    const session: CDPSession = await target.createCDPSession();

    await session.send('Fetch.enable', {
        patterns: [{ urlPattern: 'https://api.github.com/*' }],
    });

    session.on('Fetch.requestPaused', async (event: PausedRequest) => {
        requests.push(event.request.url);
        const response = responseFor(event.request.url, scenario);
        await session.send('Fetch.fulfillRequest', {
            requestId: event.requestId,
            responseCode: response.status,
            responseHeaders: [
                { name: 'content-type', value: 'application/json' },
                { name: 'x-oauth-scopes', value: 'repo' },
            ],
            body: jsonBody(response.body),
        });
    });

    return {
        requests,
        setScenario: (next) => {
            scenario = next;
        },
        resetRequests: () => requests.splice(0),
        close: async () => {
            await session.send('Fetch.disable');
            await session.detach();
        },
    };
}

export async function mockTokenValidation(
    page: Page,
    options: { status?: number; scopes?: string } = {}
) {
    const handler = async (request: HTTPRequest) => {
        if (request.url() !== 'https://api.github.com/user') {
            await request.continue();
            return;
        }
        await request.respond({
            status: options.status ?? 200,
            contentType: 'application/json',
            headers: { 'x-oauth-scopes': options.scopes ?? 'repo' },
            body: JSON.stringify({ login: 'fixture-user' }),
        });
    };
    await page.setRequestInterception(true);
    page.on('request', handler);
    return async () => {
        page.off('request', handler);
        await page.setRequestInterception(false);
    };
}

export async function clearExtensionState(page: Page) {
    await page.evaluate(async () => {
        await chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' });
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
    });
}

export async function openCleanPopup() {
    const page = await openExtensionPopup();
    await clearExtensionState(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForText(page, 'h2', 'GitHub Authentication');
    return page;
}

export async function seedEncryptedState(
    page: Page,
    options: {
        data?: AppData;
        remember?: boolean;
        theme?: ThemePreference;
        hiddenIds?: number[];
    } = {}
) {
    const data = options.data ?? appData();
    await page.evaluate(
        async ({
            dataToStore,
            hiddenIds,
            password,
            remember,
            theme,
            token,
        }) => {
            const salt = new Uint8Array([
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
            ]);
            const extension = await chrome.management.getSelf();
            const encoded = new TextEncoder().encode(
                `${extension.id}:${password}`
            );
            const material = await crypto.subtle.importKey(
                'raw',
                encoded,
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );
            const key = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt,
                    iterations: 100000,
                    hash: 'SHA-256',
                },
                material,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
            const encrypt = async (value: unknown, ivSeed: number) => {
                const iv = new Uint8Array(12).fill(ivSeed);
                const plaintext = new TextEncoder().encode(
                    typeof value === 'string' ? value : JSON.stringify(value)
                );
                const encrypted = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    plaintext
                );
                return {
                    data: Array.from(new Uint8Array(encrypted)),
                    iv: Array.from(iv),
                };
            };
            const encryptedToken = await encrypt(token, 1);
            const testVector = await encrypt('PR_TRACKER_VALID', 2);
            const encryptedData = await encrypt(dataToStore, 3);
            const encryptedHidden = await encrypt(hiddenIds, 4);

            await chrome.storage.local.set({
                prtracker_salt: Array.from(salt),
                encryptedGithubToken: encryptedToken.data,
                prtracker_iv: encryptedToken.iv,
                encryptionTestVector: testVector,
                encryptedAppData: encryptedData.data,
                appDataIv: encryptedData.iv,
                encryptedHiddenPrIds: encryptedHidden.data,
                hiddenPrIdsIv: encryptedHidden.iv,
                'theme-preference': theme,
            });
            await chrome.runtime.sendMessage({
                type: 'SET_PASSWORD',
                password,
                remember,
            });
        },
        {
            dataToStore: data,
            hiddenIds: options.hiddenIds ?? [],
            password: TEST_PASSWORD,
            remember: options.remember ?? true,
            theme: options.theme ?? 'auto',
            token: TEST_TOKEN,
        }
    );
}

export async function openSeededPopup(
    mock: GitHubMock,
    options: Parameters<typeof seedEncryptedState>[1] = {}
) {
    mock.setScenario({
        pullRequests: options.data?.pullRequests ?? POPULATED_PRS,
    });
    const page = await openCleanPopup();
    await seedEncryptedState(page, options);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForText(page, 'h2', 'Pull Requests');
    const expectedPrs = options.data?.pullRequests ?? POPULATED_PRS;
    if (expectedPrs.length > 0) {
        await waitForText(page, 'li', expectedPrs[0].title);
        await page.waitForFunction(
            (count) => document.querySelectorAll('li').length === count,
            {},
            expectedPrs.length
        );
    }
    return page;
}

export async function waitForText(
    page: Page,
    selector: string,
    expected: string,
    timeout = 10000
) {
    await page.waitForFunction(
        (candidate, text) =>
            Array.from(document.querySelectorAll(candidate)).some((element) =>
                element.textContent?.includes(text)
            ),
        { timeout },
        selector,
        expected
    );
}

export async function waitForDashboard(page: Page) {
    await waitForText(page, 'h2', 'Pull Requests');
    await page.waitForSelector('[aria-label="Refresh Pull Requests"]');
}

export async function readAppData(page: Page): Promise<AppData> {
    return page.evaluate(async (password) => {
        const stored = await chrome.storage.local.get([
            'prtracker_salt',
            'encryptedAppData',
            'appDataIv',
        ]);
        const extension = await chrome.management.getSelf();
        const material = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(`${extension.id}:${password}`),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: new Uint8Array(stored.prtracker_salt),
                iterations: 100000,
                hash: 'SHA-256',
            },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(stored.appDataIv) },
            key,
            new Uint8Array(stored.encryptedAppData)
        );
        return JSON.parse(new TextDecoder().decode(decrypted));
    }, TEST_PASSWORD);
}

export async function writeAppData(page: Page, data: AppData): Promise<void> {
    await page.evaluate(
        async ({ dataToStore, password }) => {
            const stored = await chrome.storage.local.get('prtracker_salt');
            const extension = await chrome.management.getSelf();
            const material = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(`${extension.id}:${password}`),
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );
            const key = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: new Uint8Array(stored.prtracker_salt),
                    iterations: 100000,
                    hash: 'SHA-256',
                },
                material,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const plaintext = new TextEncoder().encode(
                JSON.stringify(dataToStore)
            );
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                plaintext
            );

            await chrome.storage.local.set({
                encryptedAppData: Array.from(new Uint8Array(encrypted)),
                appDataIv: Array.from(iv),
            });
        },
        { dataToStore: data, password: TEST_PASSWORD }
    );
}

export async function resetManualRefreshThrottle() {
    const target = await getBrowser().waitForTarget(
        (candidate) =>
            candidate.type() === 'service_worker' &&
            candidate
                .url()
                .startsWith(`chrome-extension://${getExtensionId()}/`)
    );
    const worker = await target.worker();
    await worker?.evaluate(() => {
        (
            globalThis as typeof globalThis & { _prTrackerLastManual?: number }
        )._prTrackerLastManual = 0;
    });
}

export const deterministicAppData = (prs = POPULATED_PRS) => ({
    ...appData(prs),
    lastUpdated: FIXED_UPDATED_AT,
});
