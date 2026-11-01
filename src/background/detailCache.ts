import { z } from 'zod';
import { createDetailCacheCipher } from '../services/secureStorage';
import {
    assertRefreshSessionValid,
    type RefreshSessionContext,
} from './refreshSession';

export const DETAIL_CACHE_MAX_ENTRIES = 100;
export const DETAIL_CACHE_MAX_BODY_BYTES = 64 * 1024;
export const DETAIL_CACHE_MAX_TOTAL_BYTES = 1024 * 1024;
export const DETAIL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACCEPT = 'application/vnd.github.v3+json';
const CACHE_VERSION = 1;
const encoder = new TextEncoder();

const EntrySchema = z
    .object({
        version: z.literal(CACHE_VERSION),
        key: z.string().max(1000),
        etag: z.string().max(256),
        id: z.number().int().nonnegative(),
        htmlUrl: z.string().url(),
        detail: z.record(z.string(), z.unknown()),
        updatedAt: z.number().int().nonnegative(),
    })
    .strict();
const CacheSchema = z
    .object({
        version: z.literal(CACHE_VERSION),
        scope: z.string().regex(/^[0-9a-f]{64}$/),
        entries: z.array(EntrySchema).max(DETAIL_CACHE_MAX_ENTRIES),
    })
    .strict();
type Entry = z.infer<typeof EntrySchema>;

export type DetailCacheMetrics = {
    conditional: number;
    responses200: number;
    responses304: number;
    missing: number;
    evictions: number;
    bodyBytes: number;
    encryptedBytes: number;
    loadMs: number;
    writeMs: number;
    refreshMs: number;
    rateRemaining: number | null;
};

let writeQueue: Promise<void> = Promise.resolve();

export function waitForDetailCacheWrites(): Promise<void> {
    return writeQueue;
}

function cacheKey(url: string): string | null {
    try {
        const target = new URL(url);
        if (
            target.origin !== 'https://api.github.com' ||
            !/^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(target.pathname) ||
            target.search ||
            target.hash
        )
            return null;
        return JSON.stringify([target.origin, target.href, ACCEPT]);
    } catch {
        return null;
    }
}

function validEtag(value: string | null): value is string {
    return Boolean(value && /^(?:W\/)?"[\x21\x23-\x7e]{1,200}"$/.test(value));
}

function bodyBytes(value: unknown): number {
    return encoder.encode(JSON.stringify(value)).byteLength;
}

function validKey(key: string): boolean {
    try {
        const parts: unknown = JSON.parse(key);
        return (
            Array.isArray(parts) &&
            parts.length === 3 &&
            typeof parts[1] === 'string' &&
            cacheKey(parts[1]) === key
        );
    } catch {
        return false;
    }
}

function selectEntries(entries: Entry[], now: number) {
    const selected: Entry[] = [];
    let bytes = 0;
    let evictions = 0;
    for (const entry of entries.sort(
        (left, right) => right.updatedAt - left.updatedAt
    )) {
        const size = bodyBytes(entry.detail);
        if (
            entry.updatedAt > now ||
            now - entry.updatedAt > DETAIL_CACHE_MAX_AGE_MS ||
            size > DETAIL_CACHE_MAX_BODY_BYTES ||
            selected.length >= DETAIL_CACHE_MAX_ENTRIES ||
            bytes + size > DETAIL_CACHE_MAX_TOTAL_BYTES ||
            !validEtag(entry.etag) ||
            !validKey(entry.key) ||
            entry.detail.id !== entry.id ||
            entry.detail.html_url !== entry.htmlUrl
        ) {
            evictions++;
            continue;
        }
        bytes += size;
        selected.push(entry);
    }
    return { selected, evictions };
}

export async function createDetailCache(
    password: string,
    token: string,
    account: string,
    refreshSession: RefreshSessionContext
) {
    assertRefreshSessionValid(refreshSession);
    const started = performance.now();
    const metrics: DetailCacheMetrics = {
        conditional: 0,
        responses200: 0,
        responses304: 0,
        missing: 0,
        evictions: 0,
        bodyBytes: 0,
        encryptedBytes: 0,
        loadMs: 0,
        writeMs: 0,
        refreshMs: 0,
        rateRemaining: null,
    };
    const identity = encoder.encode(
        JSON.stringify([account.toLowerCase(), token])
    );
    const digest = await crypto.subtle.digest('SHA-256', identity);
    assertRefreshSessionValid(refreshSession);
    const scope = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
    ).join('');
    let cipher: Awaited<ReturnType<typeof createDetailCacheCipher>> | null =
        null;
    let stored: unknown = null;
    try {
        cipher = await createDetailCacheCipher(password);
        assertRefreshSessionValid(refreshSession);
        const loaded = await cipher.load();
        stored = loaded?.value ?? null;
        metrics.encryptedBytes = loaded?.encryptedBytes ?? 0;
        assertRefreshSessionValid(refreshSession);
    } catch {
        assertRefreshSessionValid(refreshSession);
    }
    const parsed = CacheSchema.safeParse(stored);
    const entries = new Map<string, Entry>();
    if (parsed.success && parsed.data.scope === scope) {
        const bounded = selectEntries(parsed.data.entries, Date.now());
        for (const entry of bounded.selected) entries.set(entry.key, entry);
        metrics.evictions = bounded.evictions;
    } else if (stored !== null) {
        metrics.missing++;
    }
    metrics.loadMs = performance.now() - started;
    let dirty = metrics.evictions > 0 || (stored !== null && !parsed.success);

    return {
        metrics,
        lookup(url: string): Entry | null {
            assertRefreshSessionValid(refreshSession);
            const key = cacheKey(url);
            let entry = key ? entries.get(key) : undefined;
            const now = Date.now();
            if (
                entry &&
                (entry.updatedAt > now ||
                    now - entry.updatedAt > DETAIL_CACHE_MAX_AGE_MS)
            ) {
                entries.delete(entry.key);
                metrics.evictions++;
                dirty = true;
                entry = undefined;
            }
            if (!entry) metrics.missing++;
            else metrics.conditional++;
            return entry ?? null;
        },
        discard(url: string): void {
            assertRefreshSessionValid(refreshSession);
            const key = cacheKey(url);
            if (key && entries.delete(key)) {
                metrics.evictions++;
                dirty = true;
            }
        },
        observe(response: Response): void {
            assertRefreshSessionValid(refreshSession);
            const header = response.headers.get('x-ratelimit-remaining');
            const remaining = header === null ? NaN : Number(header);
            if (Number.isSafeInteger(remaining) && remaining >= 0)
                metrics.rateRemaining = remaining;
        },
        record(
            url: string,
            response: Response,
            responseBody: unknown,
            detail: unknown = responseBody
        ): void {
            assertRefreshSessionValid(refreshSession);
            metrics.responses200++;
            metrics.bodyBytes += bodyBytes(responseBody);
            const key = cacheKey(url);
            if (!key) return;
            const etag = response.headers.get('etag');
            const data = EntrySchema.safeParse({
                version: CACHE_VERSION,
                key,
                etag,
                id: (detail as { id?: unknown })?.id,
                htmlUrl: (detail as { html_url?: unknown })?.html_url,
                detail,
                updatedAt: Date.now(),
            });
            if (
                !etag ||
                !validEtag(etag) ||
                !data.success ||
                bodyBytes(detail) > DETAIL_CACHE_MAX_BODY_BYTES
            ) {
                if (entries.delete(key)) dirty = true;
                return;
            }
            entries.set(key, data.data);
            dirty = true;
        },
        record304(response: Response): void {
            assertRefreshSessionValid(refreshSession);
            metrics.responses304++;
            this.observe(response);
        },
        async persist(): Promise<void> {
            assertRefreshSessionValid(refreshSession);
            if (!dirty || !cipher) return;
            const bounded = selectEntries([...entries.values()], Date.now());
            metrics.evictions += bounded.evictions;
            const payload = {
                version: CACHE_VERSION,
                scope,
                entries: bounded.selected,
            };
            const save = writeQueue.then(async () => {
                assertRefreshSessionValid(refreshSession);
                const writeStarted = performance.now();
                metrics.encryptedBytes = await cipher.save(payload, () =>
                    assertRefreshSessionValid(refreshSession)
                );
                assertRefreshSessionValid(refreshSession);
                metrics.writeMs = performance.now() - writeStarted;
            });
            writeQueue = save.then(
                () => undefined,
                () => undefined
            );
            await save;
        },
    };
}

export type DetailCache = Awaited<ReturnType<typeof createDetailCache>>;
