import { expect, it } from 'vitest';
import { getBrowser, openExtensionPopup } from './setup';
import { seedEncryptedState } from './harness';
import { appData, POPULATED_PRS } from './fixtures';

it('measures repeated refreshes with real browser encryption and storage', async () => {
    const page = await openExtensionPopup();
    try {
        const prs = Array.from({ length: 40 }, (_, index) => ({
            ...POPULATED_PRS[0],
            id: index + 1,
            title: `Measured fixture ${index + 1}`,
            repository: { name: 'measure' },
        }));
        await seedEncryptedState(page, { data: appData(prs) });
        await page.evaluate(() => {
            chrome.runtime.onMessage.addListener(
                (message: { type?: string }) => {
                    if (message.type === 'MEASURE_READY')
                        chrome.runtime.sendMessage({ type: 'MEASURE_BEGIN' });
                    if (message.type === 'MEASURE_RUN') {
                        chrome.runtime
                            .sendMessage({
                                type: 'CHECK_PRS',
                                manual: true,
                                customQuery: 'is:pr repo:acme/measure',
                            })
                            .then(() =>
                                chrome.runtime.sendMessage({
                                    type: 'MEASURE_DONE',
                                })
                            );
                    }
                }
            );
        });
        const target = await getBrowser().waitForTarget(
            (target) => target.type() === 'service_worker'
        );
        const worker = (await target.worker())!;
        const rows = await worker.evaluate(async (prs) => {
            type Row = {
                mode: string;
                requests: number;
                responses200: number;
                responses304: number;
                bodyBytes: number;
                loadMs: number;
                deriveMs: number;
                decryptMs: number;
                encryptMs: number;
                storageGetMs: number;
                storageSetMs: number;
                refreshMs: number;
                ciphertextChars: number;
            };
            const scope = globalThis as typeof globalThis & {
                _prTrackerLastManual: number;
            };
            const originalFetch = scope.fetch;
            const subtle = crypto.subtle;
            const digest = subtle.digest.bind(subtle);
            const derive = subtle.deriveKey.bind(subtle);
            const decrypt = subtle.decrypt.bind(subtle);
            const encrypt = subtle.encrypt.bind(subtle);
            const get = chrome.storage.local.get.bind(chrome.storage.local);
            const set = chrome.storage.local.set.bind(chrome.storage.local);
            let row: Row;
            let loading = false;
            let loadStarted = 0;
            let disabled = false;
            const rows: Row[] = [];
            // Timers wrap native APIs; only transport and optional-cache availability are controlled.
            subtle.digest = async (...args) => {
                if (disabled)
                    throw new Error('Benchmark without optional cache');
                loading = true;
                loadStarted = performance.now();
                return digest(...args);
            };
            subtle.deriveKey = async (...args) => {
                const timed = loading;
                const started = performance.now();
                const result = await derive(...args);
                if (timed) row.deriveMs += performance.now() - started;
                return result;
            };
            subtle.decrypt = async (...args) => {
                const timed = loading;
                const started = performance.now();
                const result = await decrypt(...args);
                if (timed) row.decryptMs += performance.now() - started;
                return result;
            };
            subtle.encrypt = async (...args) => {
                const text = new TextDecoder().decode(args[2]);
                const timed = text.startsWith('{"version":1,"scope":');
                const started = performance.now();
                const result = await encrypt(...args);
                if (timed) row.encryptMs += performance.now() - started;
                return result;
            };
            chrome.storage.local.get = ((
                keys: string | string[],
                callback?: (value: Record<string, unknown>) => void
            ) => {
                const timed = JSON.stringify(keys).includes(
                    'encryptedDetailCache'
                );
                const started = performance.now();
                const finish = (result: Record<string, unknown>) => {
                    if (timed) {
                        row.storageGetMs += performance.now() - started;
                        row.ciphertextChars =
                            typeof result.encryptedDetailCache === 'string'
                                ? result.encryptedDetailCache.length
                                : 0;
                    }
                    return result;
                };
                if (callback)
                    return get(keys, (result) => callback(finish(result)));
                return get(keys).then(finish);
            }) as typeof get;
            chrome.storage.local.set = ((
                items: Record<string, unknown>,
                callback?: () => void
            ) => {
                const timed = 'encryptedDetailCache' in items;
                const started = performance.now();
                const finish = () => {
                    if (timed) {
                        row.storageSetMs += performance.now() - started;
                        row.ciphertextChars = String(
                            items.encryptedDetailCache
                        ).length;
                    }
                };
                if (callback)
                    return set(items, () => {
                        finish();
                        callback();
                    });
                return set(items).then(finish);
            }) as typeof set;
            scope.fetch = async (input, init) => {
                const url = String(input);
                row.requests++;
                let body: unknown;
                let status = 200;
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                };
                if (url.endsWith('/user')) body = { login: 'fixture-user' };
                else if (url.includes('/search/issues')) {
                    if (loading) {
                        row.loadMs = performance.now() - loadStarted;
                        loading = false;
                    }
                    body = {
                        total_count: prs.length,
                        incomplete_results: false,
                        items: prs.map((pr) => ({
                            pull_request: {
                                url: `https://api.github.com/repos/acme/measure/pulls/${pr.id}`,
                            },
                        })),
                    };
                } else if (url.includes('/reviews?'))
                    body = [{ user: { id: 1 }, state: 'COMMENTED' }];
                else if (url.includes('/check-runs?'))
                    body = {
                        total_count: 1,
                        check_runs: [
                            {
                                id: 1,
                                status: 'completed',
                                conclusion: 'success',
                            },
                        ],
                    };
                else {
                    const id = Number(new URL(url).pathname.split('/').at(-1));
                    const pr = prs.find((pr) => pr.id === id);
                    if (!pr) throw new Error('Unexpected measurement request');
                    headers.ETag = `"measure-${id}"`;
                    status =
                        new Headers(init?.headers).get('if-none-match') ===
                        headers.ETag
                            ? 304
                            : 200;
                    body = {
                        ...pr,
                        body: 'x'.repeat(20000),
                        user: pr.author,
                        base: {
                            repo: {
                                name: 'measure',
                                url: 'https://api.github.com/repos/acme/measure',
                            },
                        },
                        head: { sha: `sha-${id}` },
                    };
                    if (status === 304) row.responses304++;
                    else row.responses200++;
                }
                const text = status === 304 ? null : JSON.stringify(body);
                row.bodyBytes += text
                    ? new TextEncoder().encode(text).length
                    : 0;
                return new Response(text, { status, headers });
            };
            try {
                for (let round = 0; round < 5; round++) {
                    for (const mode of ['disabled', 'cold', 'warm']) {
                        if (mode !== 'warm')
                            await chrome.storage.local.remove([
                                'encryptedDetailCache',
                                'detailCacheIv',
                            ]);
                        disabled = mode === 'disabled';
                        loading = false;
                        row = {
                            mode,
                            requests: 0,
                            responses200: 0,
                            responses304: 0,
                            bodyBytes: 0,
                            loadMs: 0,
                            deriveMs: 0,
                            decryptMs: 0,
                            encryptMs: 0,
                            storageGetMs: 0,
                            storageSetMs: 0,
                            refreshMs: 0,
                            ciphertextChars: 0,
                        };
                        // The page sends the request so it reaches the background's listener.
                        await new Promise<void>((resolve) => {
                            const listener = (message: { type?: string }) => {
                                if (message.type === 'MEASURE_BEGIN') {
                                    chrome.runtime.onMessage.removeListener(
                                        listener
                                    );
                                    resolve();
                                }
                            };
                            chrome.runtime.onMessage.addListener(listener);
                            chrome.runtime.sendMessage({
                                type: 'MEASURE_READY',
                            });
                        });
                        scope._prTrackerLastManual = 0;
                        const started = performance.now();
                        // Completion is acknowledged from the popup after CHECK_PRS settles.
                        await new Promise<void>((resolve) => {
                            const listener = (message: { type?: string }) => {
                                if (message.type === 'MEASURE_DONE') {
                                    chrome.runtime.onMessage.removeListener(
                                        listener
                                    );
                                    resolve();
                                }
                            };
                            chrome.runtime.onMessage.addListener(listener);
                            chrome.runtime.sendMessage({ type: 'MEASURE_RUN' });
                        });
                        row.refreshMs = performance.now() - started;
                        rows.push(row);
                    }
                }
                return rows;
            } finally {
                scope.fetch = originalFetch;
                subtle.digest = digest;
                subtle.deriveKey = derive;
                subtle.decrypt = decrypt;
                subtle.encrypt = encrypt;
                chrome.storage.local.get = get;
                chrome.storage.local.set = set;
            }
        }, prs);
        expect(rows).toHaveLength(15);
        expect(
            rows
                .filter((row) => row.mode === 'warm')
                .every(
                    (row) =>
                        row.responses304 === 40 &&
                        row.responses200 === 0 &&
                        row.requests === 122
                )
        ).toBe(true);
        console.info('CACHE_BROWSER_MEASUREMENT', JSON.stringify(rows));
    } finally {
        await page.close();
    }
});
