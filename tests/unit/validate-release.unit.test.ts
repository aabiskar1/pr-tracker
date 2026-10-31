import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { validateRelease } from '../../scripts/validate-release.mjs';

vi.mock('node:fs', () => ({ writeFileSync: vi.fn(), appendFileSync: vi.fn() }));

const sha = 'a'.repeat(40);
const bytes = Buffer.from('original release ZIP');
const hash = createHash('sha256').update(bytes).digest('hex');

function validate(options: Record<string, unknown> = {}) {
    const browser = (options.browser as string) || 'chrome';
    const asset = {
        name: `extension-${browser}.zip`,
        id: 42,
        state: 'uploaded',
        size: bytes.length,
        digest: `sha256:${hash}`,
        ...(options.asset as object),
    };
    const snapshot = {
        id: 1,
        sha,
        assets: {
            [browser]: {
                id: 42,
                size: bytes.length,
                digest: `sha256:${hash}`,
                sha256: hash,
            },
        },
        ...(options.snapshot as object),
    };
    const commands: string[][] = [];
    const env = {
        TAG: 'v1.0.22',
        STORE: browser,
        GITHUB_REPOSITORY: 'aabiskar1/pr-tracker',
        ...(options.env as object),
    };
    const manifest = {
        name: 'PR Tracker',
        version: '1.0.22',
        manifest_version: browser === 'chrome' ? 3 : 2,
        browser_specific_settings: {
            gecko: { id: '{dabd690e-283a-4c0a-98de-3fc963365d13}' },
        },
        ...(options.manifest as object),
    };
    const responses: Record<string, unknown> = {
        'releases/tags/v1.0.22': {
            id: 1,
            tag_name: 'v1.0.22',
            draft: false,
            prerelease: false,
            published_at: '2026-10-30',
            target_commitish: sha,
            assets: [asset],
            ...(options.release as object),
        },
        'git/ref/tags/v1.0.22': {
            ref: 'refs/tags/v1.0.22',
            object: { type: 'commit', sha },
        },
        [`commits/${sha}`]: { sha },
        [`compare/${sha}...main`]: { status: 'ahead' },
        [`contents/package.json?ref=${sha}`]: {
            encoding: 'base64',
            content: Buffer.from('{"version":"1.0.22"}').toString('base64'),
        },
        ...(options.responses as object),
    };
    const execFileSync = (command: string, args: string[]) => {
        commands.push([command, ...args]);
        if (command === 'gh') {
            const path = args.find((arg) => arg.startsWith('repos/'))!;
            const endpoint = path.replace('repos/aabiskar1/pr-tracker/', '');
            if (endpoint === options.apiFailure) throw new Error('API failure');
            if (['releases/assets/42', 'releases/assets/43'].includes(endpoint))
                return options.data || bytes;
            if (!(endpoint in responses)) throw new Error('API failure');
            return JSON.stringify(responses[endpoint]);
        }
        if (args[0] === '-t') {
            if (options.corruptArchive) throw new Error('Corrupt ZIP');
            return '';
        }
        if (args[0] === '-p')
            return args[2] === 'manifest.json'
                ? JSON.stringify({
                      ...manifest,
                      ...(env.STORE === 'both'
                          ? {
                                manifest_version: args[1].includes('firefox')
                                    ? 2
                                    : 3,
                            }
                          : {}),
                  })
                : options.javascript || 'production JavaScript';
        return (
            options.entries ||
            'manifest.json\nbackground.js\nbranding/watchtower.png\nicons/icon-16.png\nicons/icon-32.png\nicons/icon-48.png\nicons/icon-128.png'
        );
    };
    const result = validateRelease(
        {
            tag: env.TAG,
            store: env.STORE,
            repo: env.GITHUB_REPOSITORY,
            expectedSnapshot: options.publishing ? snapshot : undefined,
        },
        execFileSync
    );
    return { result, commands };
}

describe('release validator', () => {
    it('downloads both original browser assets when both stores are selected', () => {
        const assets = ['chrome', 'firefox'].map((browser, index) => ({
            id: 42 + index,
            name: `extension-${browser}.zip`,
            state: 'uploaded',
            size: bytes.length,
            digest: `sha256:${hash}`,
        }));
        const { result } = validate({
            env: { STORE: 'both' },
            release: { assets },
        });
        expect(Object.keys(result.assets)).toEqual(['chrome', 'firefox']);
    });
    it.each(['chrome', 'firefox'])(
        'accepts a historical main release for %s',
        (browser) => {
            const result = validate({ browser, publishing: true });
            expect(result.result.assets[browser].sha256).toBe(hash);
            expect(
                result.commands.some((command) =>
                    command.includes(
                        'repos/aabiskar1/pr-tracker/releases/assets/42'
                    )
                )
            ).toBe(true);
            expect(result.commands.flat()).not.toContain('--method');
        }
    );

    it.each([
        { env: { TAG: 'v1.0.22;echo bad' } },
        { env: { STORE: 'unknown' } },
        { env: { GITHUB_REPOSITORY: 'somebody/else' } },
        { release: { draft: true } },
        { release: { prerelease: true } },
        { release: { target_commitish: 'b'.repeat(40) } },
        { asset: { digest: `sha256:${'0'.repeat(64)}` } },
        { asset: { size: 999 } },
        { asset: { state: 'new' } },
        { asset: { id: -1 } },
        { asset: { digest: 'md5:unsupported' } },
        { release: { assets: [] } },
        {
            release: {
                assets: [
                    { name: 'extension-chrome.zip' },
                    { name: 'extension-chrome.zip' },
                ],
            },
        },
        { manifest: { version: '1.0.21' } },
        { manifest: { manifest_version: 2 } },
        { manifest: { key: 'wrong-key' } },
        { browser: 'firefox', manifest: { browser_specific_settings: {} } },
        { entries: '../manifest.json' },
        { entries: 'manifest.json\nmanifest.json' },
        { entries: '/manifest.json' },
        { entries: 'background.js.map' },
        { entries: '.env.test' },
        { javascript: 'TEST_RESET_BACKGROUND_STATE' },
        { publishing: true, snapshot: { sha: 'b'.repeat(40) } },
        { publishing: true, snapshot: { assets: {} } },
        { responses: { [`compare/${sha}...main`]: { status: 'diverged' } } },
        {
            responses: {
                [`contents/package.json?ref=${sha}`]: {
                    encoding: 'base64',
                    content: Buffer.from('{"version":"1.0.21"}').toString(
                        'base64'
                    ),
                },
            },
        },
        { apiFailure: 'releases/tags/v1.0.22' },
        { apiFailure: 'releases/assets/42' },
        { corruptArchive: true },
    ])('fails closed for invalid input, API data, or assets: %j', (options) => {
        expect(() => validate(options)).toThrow();
    });

    it('accepts missing upstream digest and binds approval to a computed hash', () => {
        expect(
            validate({ asset: { digest: null } }).result.assets.chrome.sha256
        ).toBe(hash);
    });

    it('rejects changed bytes before writing or inspecting the archive', () => {
        vi.mocked(writeFileSync).mockClear();
        const changed = Buffer.from(bytes);
        changed[0] ^= 1;
        expect(() => validate({ data: changed })).toThrow(
            'Asset SHA-256 mismatch'
        );
        expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('checks the approval snapshot even when GitHub supplies no digest', () => {
        const changed = Buffer.from(bytes);
        changed[0] ^= 1;
        expect(() =>
            validate({
                publishing: true,
                data: changed,
                asset: { digest: null },
                snapshot: {
                    assets: {
                        chrome: {
                            id: 42,
                            size: bytes.length,
                            digest: null,
                            sha256: hash,
                        },
                    },
                },
            })
        ).toThrow('Asset changed after inspection');
    });

    it('resolves an annotated tag to its historical repository commit', () => {
        expect(() =>
            validate({
                responses: {
                    'git/ref/tags/v1.0.22': {
                        ref: 'refs/tags/v1.0.22',
                        object: { type: 'tag', sha: 'b'.repeat(40) },
                    },
                    [`git/tags/${'b'.repeat(40)}`]: {
                        object: { type: 'commit', sha },
                    },
                },
            })
        ).not.toThrow();
    });
});
