import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
    assertReleaseContext,
    assertRemoteRelease,
    releaseMetadata,
    verifyReleaseAssets,
} from '../../scripts/release.mjs';

const sha = 'a'.repeat(40);
const context = {
    mode: 'GitHub Release',
    ref: 'refs/heads/main',
    sha,
    attempt: '1',
    mainSha: sha,
};
const metadata = releaseMetadata(
    { version: '1.0.22' },
    { version: '1.0.22', packages: { '': { version: '1.0.22' } } }
);

describe('release safety guards', () => {
    it('derives versioned packages and the matching notes file from package metadata', () => {
        expect(metadata).toEqual({
            version: '1.0.22',
            tag: 'v1.0.22',
            notes: 'docs/release-notes-1.0.22.md',
            chrome: 'pr-tracker-1.0.22-chrome.zip',
            firefox: 'pr-tracker-1.0.22-firefox.zip',
        });
    });

    it.each([
        { version: '1.0.21', packages: { '': { version: '1.0.22' } } },
        { version: '1.0.22', packages: { '': { version: '1.0.21' } } },
    ])('rejects mismatched package-lock metadata', (lock) => {
        expect(() => releaseMetadata({ version: '1.0.22' }, lock)).toThrow();
    });

    it('rejects unsafe/pre-release version strings', () => {
        expect(() =>
            releaseMetadata({ version: '1.0.22; echo unsafe' }, {})
        ).toThrow();
    });

    it.each(['GitHub Release', 'Full Release'])(
        'allows %s only on the first attempt at latest main',
        (mode) => {
            expect(() =>
                assertReleaseContext({ ...context, mode })
            ).not.toThrow();
        }
    );

    it.each([
        { ref: 'refs/heads/release/1.0.22' },
        { mainSha: 'b'.repeat(40) },
        { attempt: '2' },
        { sha: 'not-a-sha' },
        { mode: 'unexpected' },
    ])('rejects unsafe release context %j', (override) => {
        expect(() =>
            assertReleaseContext({ ...context, ...override })
        ).toThrow();
    });

    it('permits dry runs on branches and retries without calling GitHub', async () => {
        const api = vi.fn();
        await assertRemoteRelease(
            {
                ...context,
                mode: 'Dry Run',
                ref: 'refs/heads/feature',
                attempt: '3',
            },
            metadata,
            api
        );
        expect(api).not.toHaveBeenCalled();
        await expect(
            assertRemoteRelease(
                { ...context, mode: 'Dry Run' },
                metadata,
                api,
                'store'
            )
        ).rejects.toThrow();
    });

    it.each(['tag', 'published release', 'draft release'])(
        'refuses an existing %s',
        async (existing) => {
            const api = vi.fn(async (path) => {
                if (path.endsWith('heads/main')) return { object: { sha } };
                if (path.includes('/git/ref/tags/'))
                    return existing === 'tag' ? { object: { sha } } : null;
                return existing === 'tag'
                    ? null
                    : { draft: existing === 'draft release' };
            });
            await expect(
                assertRemoteRelease(context, metadata, api)
            ).rejects.toThrow();
        }
    );

    it.each(['new', 'assets', 'store'])(
        'rechecks latest main at the %s stage',
        async (stage) => {
            const api = vi.fn(async () => ({
                object: { sha: 'b'.repeat(40) },
            }));
            await expect(
                assertRemoteRelease(
                    { ...context, mode: 'Full Release' },
                    metadata,
                    api,
                    stage
                )
            ).rejects.toThrow('latest main');
            expect(api).toHaveBeenCalledExactlyOnceWith('/git/ref/heads/main');
        }
    );

    it('publishes only a newly created draft after asset verification', async () => {
        const release = { tag_name: metadata.tag, draft: true };
        const api = vi.fn(async (path) =>
            path.endsWith('heads/main')
                ? { object: { sha } }
                : path.includes('/git/ref/')
                  ? { object: { type: 'commit', sha } }
                  : release
        );
        await expect(
            assertRemoteRelease(context, metadata, api, 'assets')
        ).resolves.toEqual(release);
        release.draft = false;
        await expect(
            assertRemoteRelease(context, metadata, api, 'assets')
        ).rejects.toThrow('newly created draft');
    });

    it('fails closed on GitHub/network failures', async () => {
        await expect(
            assertRemoteRelease(
                context,
                metadata,
                vi.fn().mockRejectedValue(new Error('HTTP 403'))
            )
        ).rejects.toThrow('HTTP 403');
    });

    it('permits store submission only for Full Release and a published tag at the same commit', async () => {
        const release = { tag_name: metadata.tag, draft: false };
        const api = vi.fn(async (path) =>
            path.endsWith('heads/main')
                ? { object: { sha } }
                : path.includes('/git/ref/')
                  ? { object: { type: 'commit', sha } }
                  : release
        );
        await expect(
            assertRemoteRelease(
                { ...context, mode: 'Full Release' },
                metadata,
                api,
                'store'
            )
        ).resolves.toEqual(release);
        await expect(
            assertRemoteRelease(context, metadata, api, 'store')
        ).rejects.toThrow();
        release.draft = true;
        await expect(
            assertRemoteRelease(
                { ...context, mode: 'Full Release' },
                metadata,
                api,
                'store'
            )
        ).rejects.toThrow();
    });

    it('rejects a tag moved to another commit', async () => {
        const api = vi.fn(async (path) =>
            path.endsWith('heads/main')
                ? { object: { sha } }
                : { object: { type: 'commit', sha: 'b'.repeat(40) } }
        );
        await expect(
            assertRemoteRelease(
                { ...context, mode: 'Full Release' },
                metadata,
                api,
                'store'
            )
        ).rejects.toThrow('another commit');
    });
});

describe('published package identity', () => {
    let directory: string;
    afterEach(() => {
        if (directory) rmSync(directory, { recursive: true, force: true });
    });
    it('requires both complete ZIPs with exact sizes and SHA-256 digests', () => {
        directory = mkdtempSync(join(tmpdir(), 'pr-tracker-release-'));
        const bytes = Buffer.from('validated ZIP');
        const assets = [metadata.chrome, metadata.firefox].map((name) => {
            writeFileSync(join(directory, name), bytes);
            return {
                name,
                size: bytes.length,
                state: 'uploaded',
                digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            };
        });
        expect(() =>
            verifyReleaseAssets({ assets }, metadata, directory)
        ).not.toThrow();
        expect(() =>
            verifyReleaseAssets(
                { assets: assets.slice(1) },
                metadata,
                directory
            )
        ).toThrow();
        for (const override of [
            { digest: 'sha256:wrong' },
            { size: 1 },
            { state: 'new' },
            { name: 'wrong-version.zip' },
        ]) {
            expect(() =>
                verifyReleaseAssets(
                    { assets: [{ ...assets[0], ...override }, assets[1]] },
                    metadata,
                    directory
                )
            ).toThrow();
        }
    });
});
