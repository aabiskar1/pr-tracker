import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const release = readFileSync('.github/workflows/release.yml', 'utf8');
const stores = readFileSync('.github/workflows/publish-stores.yml', 'utf8');
const ci = readFileSync('.github/workflows/build.yml', 'utf8');
const script = stores.match(/node <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/)![1];
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
    const output: string[] = [];
    const commands: string[][] = [];
    const env = {
        TAG: 'v1.0.22',
        STORE: browser,
        RETRY_FAILED: 'false',
        GITHUB_REPOSITORY: 'aabiskar1/pr-tracker',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_RUN_ID: '100',
        GITHUB_OUTPUT: 'output',
        ...(options.publishing
            ? { EXPECTED_SNAPSHOT: JSON.stringify(snapshot) }
            : {}),
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
        'actions/workflows/publish-stores.yml/runs?per_page=100': [
            {
                workflow_runs: [
                    {
                        id: 99,
                        display_title: `Publish v1.0.22 to ${browser}`,
                        status: 'completed',
                    },
                ],
            },
        ],
        'actions/runs/99/jobs?filter=all&per_page=100': [
            {
                jobs: [
                    {
                        name: `Publish ${browser} v1.0.22`,
                        steps: [
                            {
                                name: `Submit to ${browser}`,
                                started_at: '2026-10-30',
                                conclusion: options.previous || 'skipped',
                            },
                        ],
                    },
                ],
            },
        ],
        ...(options.responses as object),
    };
    const execFileSync = (command: string, args: string[]) => {
        commands.push([command, ...args]);
        if (command === 'gh') {
            const path = args.find((arg) => arg.startsWith('repos/'))!;
            const endpoint = path.replace('repos/aabiskar1/pr-tracker/', '');
            if (endpoint === 'releases/assets/42') return bytes;
            if (!(endpoint in responses)) throw new Error('API failure');
            return JSON.stringify(responses[endpoint]);
        }
        if (args[0] === '-t') return '';
        if (args[0] === '-p')
            return args[2] === 'manifest.json'
                ? JSON.stringify(manifest)
                : options.javascript || 'production JavaScript';
        return (
            options.entries ||
            'manifest.json\nbackground.js\nbranding/watchtower.png\nicons/icon-16.png\nicons/icon-32.png\nicons/icon-48.png\nicons/icon-128.png'
        );
    };
    new Function('require', 'process', 'Buffer', 'console', script)(
        (module: string) => {
            if (module === 'node:child_process') return { execFileSync };
            if (module === 'node:crypto') return { createHash };
            if (module === 'node:fs')
                return {
                    writeFileSync: () => {},
                    appendFileSync: (_: string, text: string) =>
                        output.push(text),
                };
            throw new Error('Unexpected module');
        },
        { env },
        Buffer,
        { log: () => {} }
    );
    return { output, commands };
}

function scheduled(
    source: string,
    job: string,
    inputs: object,
    main = true,
    attempt = 1
) {
    const block = source.split(`    ${job}:`)[1].split(/\r?\n {4}[\w-]+:/)[0];
    const condition = block.match(/if: \$\{\{ (.*?) \}\}/)![1];
    const expression = condition.replace(
        /\b(inputs|github)\.([\w-]+)/g,
        '$1["$2"]'
    );
    return new Function('inputs', 'github', `return ${expression}`)(inputs, {
        ref: main ? 'refs/heads/main' : 'refs/heads/feature',
        run_attempt: attempt,
    });
}

describe('release workflow scheduling', () => {
    it('preserves the required CI identity and checks without publishing', () => {
        expect(ci).toContain('name: buildandtest');
        expect(ci).toContain('    verify:');
        for (const command of [
            'compile',
            'lint',
            'build:all',
            'test:unit',
            'test:headless',
        ])
            expect(ci).toContain(`npm run ${command}`);
        expect(ci).not.toMatch(/contents: write|Submit to|gh release/);
    });

    it('defaults to a dry run, gates creation on main, and has no store jobs', () => {
        expect(release).toMatch(/dry-run:[\s\S]*?default: true/);
        expect(scheduled(release, 'release', { 'dry-run': true })).toBe(false);
        expect(scheduled(release, 'release', { 'dry-run': false })).toBe(true);
        expect(scheduled(release, 'release', { 'dry-run': false }, false)).toBe(
            false
        );
        expect(release).not.toMatch(
            /browser-stores|chrome-extension-upload|action-web-ext/
        );
        expect(release).toContain('test "$status" = 404');
        expect(release).toContain('--verify-tag');
        expect(
            scheduled(release, 'release', { 'dry-run': false }, true, 2)
        ).toBe(false);
        expect(scheduled(stores, 'inspect', {}, true, 2)).toBe(false);
    });

    it.each(['chrome', 'firefox', 'both'])(
        'selects only requested stores: %s',
        (store) => {
            expect(scheduled(stores, 'publish-chrome', { store })).toBe(
                store !== 'firefox'
            );
            expect(scheduled(stores, 'publish-firefox', { store })).toBe(
                store !== 'chrome'
            );
            expect(scheduled(stores, 'inspect', {}, false)).toBe(false);
            expect(stores).not.toContain('contents: write');
            expect(stores).not.toMatch(/npm (ci|run)|actions\/checkout/);
        }
    );
});

describe('original release validation and duplicate prevention', () => {
    it.each(['chrome', 'firefox'])(
        'accepts a historical main release for %s',
        (browser) => {
            const result = validate({ browser, publishing: true });
            expect(result.output[0]).toContain(hash);
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
        { env: { GITHUB_RUN_ATTEMPT: '2' } },
        { env: { STORE: 'both', RETRY_FAILED: 'true' } },
        { release: { draft: true } },
        { release: { prerelease: true } },
        { release: { target_commitish: 'b'.repeat(40) } },
        { asset: { digest: `sha256:${'0'.repeat(64)}` } },
        { asset: { size: 999 } },
        { asset: { state: 'new' } },
        { manifest: { version: '1.0.21' } },
        { manifest: { manifest_version: 2 } },
        { manifest: { key: 'wrong-key' } },
        { browser: 'firefox', manifest: { browser_specific_settings: {} } },
        { entries: '../manifest.json' },
        { entries: 'manifest.json\nmanifest.json' },
        { javascript: 'TEST_RESET_BACKGROUND_STATE' },
        { publishing: true, snapshot: { sha: 'b'.repeat(40) } },
        { publishing: true, snapshot: { assets: {} } },
        { responses: { [`compare/${sha}...main`]: { status: 'diverged' } } },
    ])('fails closed for invalid input, API data, or assets: %j', (options) => {
        expect(() => validate(options)).toThrow();
    });

    it('accepts missing upstream digest and binds approval to a computed hash', () => {
        expect(validate({ asset: { digest: null } }).output[0]).toContain(hash);
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

    it('fails closed when submission history cannot be read', () => {
        expect(() =>
            validate({
                publishing: true,
                responses: {
                    'actions/workflows/publish-stores.yml/runs?per_page=100':
                        undefined,
                },
            })
        ).toThrow();
    });

    it('blocks previous successes even when retry is acknowledged', () => {
        expect(() =>
            validate({
                publishing: true,
                previous: 'success',
                env: { RETRY_FAILED: 'true' },
            })
        ).toThrow('Already submitted');
    });

    it('requires explicit acknowledgement for an ambiguous prior failure', () => {
        expect(() =>
            validate({ publishing: true, previous: 'failure' })
        ).toThrow('Uncertain prior submission');
        expect(() =>
            validate({
                publishing: true,
                previous: 'failure',
                env: { RETRY_FAILED: 'true' },
            })
        ).not.toThrow();
    });
});
