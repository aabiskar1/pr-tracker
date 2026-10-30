import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const release = readFileSync('.github/workflows/release.yml', 'utf8');
const stores = readFileSync('.github/workflows/publish-stores.yml', 'utf8');
const ci = readFileSync('.github/workflows/build.yml', 'utf8');

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
            expect(stores).not.toMatch(/npm (ci|run)/);
            for (const job of ['publish-chrome', 'publish-firefox']) {
                expect(scheduled(stores, job, { store }, true, 2)).toBe(false);
                expect(scheduled(stores, job, { store }, false)).toBe(false);
            }
        }
    );

    it('checks out only the dispatched main revision and reuses the validator', () => {
        expect(stores.match(/ref: \$\{\{ github.sha \}\}/g)).toHaveLength(3);
        expect(stores.match(/persist-credentials: false/g)).toHaveLength(3);
        expect(
            stores.match(/run: node scripts\/validate-release.mjs/g)
        ).toHaveLength(3);
        expect(stores).not.toContain('actions: read');
        expect(stores).not.toContain('ref: ${{ inputs.release-tag }}');
    });

    it('requires explicit dashboard verification and preserves store approval/locks', () => {
        expect(stores).toMatch(/confirm-store-status:[\s\S]*?default: false/);
        expect(stores).toContain('run: test "$CONFIRMED" = true');
        expect(stores.match(/environment: browser-stores/g)).toHaveLength(2);
        expect(stores).toContain(
            'group: store-chrome-${{ inputs.release-tag }}'
        );
        expect(stores).toContain(
            'group: store-firefox-${{ inputs.release-tag }}'
        );
    });
});
