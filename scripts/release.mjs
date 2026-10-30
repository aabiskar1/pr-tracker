import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_MODES = ['Dry Run', 'GitHub Release', 'Full Release'];

export function releaseMetadata(pkg, lock) {
    assert.match(
        pkg.version,
        /^\d+\.\d+\.\d+$/,
        'Use a stable extension version'
    );
    assert.equal(lock.version, pkg.version, 'Lockfile version differs');
    assert.equal(
        lock.packages[''].version,
        pkg.version,
        'Root version differs'
    );
    return {
        version: pkg.version,
        tag: `v${pkg.version}`,
        notes: `docs/release-notes-${pkg.version}.md`,
        chrome: `pr-tracker-${pkg.version}-chrome.zip`,
        firefox: `pr-tracker-${pkg.version}-firefox.zip`,
    };
}

export function assertReleaseContext({ mode, ref, sha, attempt, mainSha }) {
    assert.ok(RELEASE_MODES.includes(mode), 'Unknown release mode');
    if (mode === 'Dry Run') return;
    assert.equal(ref, 'refs/heads/main', 'Real releases require main');
    assert.equal(
        String(attempt),
        '1',
        'Real releases cannot be retried automatically'
    );
    assert.match(sha, /^[a-f0-9]{40}$/, 'Invalid release commit');
    assert.equal(sha, mainSha, 'Release commit is no longer latest main');
}

export async function assertRemoteRelease(
    context,
    metadata,
    api,
    stage = 'new'
) {
    assert.ok(RELEASE_MODES.includes(context.mode), 'Unknown release mode');
    if (context.mode === 'Dry Run') {
        assert.equal(stage, 'new', 'Dry Run cannot publish');
        return;
    }
    if (stage === 'store') assert.equal(context.mode, 'Full Release');
    const main = await api('/git/ref/heads/main');
    assertReleaseContext({ ...context, mainSha: main?.object?.sha });
    const tag = await api(`/git/ref/tags/${metadata.tag}`);
    const release = await api(`/releases/tags/${metadata.tag}`);
    if (stage === 'new') {
        assert.equal(tag, null, 'Tag already exists; reconcile manually');
        assert.equal(
            release,
            null,
            'Release already exists; reconcile manually'
        );
    } else {
        assert.equal(
            tag?.object?.type,
            'commit',
            'Expected the exact lightweight tag'
        );
        assert.equal(
            tag.object.sha,
            context.sha,
            'Tag points to another commit'
        );
        assert.equal(
            release?.tag_name,
            metadata.tag,
            'Release is missing or changed'
        );
        if (stage === 'store')
            assert.equal(release.draft, false, 'Release is still a draft');
        if (stage === 'assets')
            assert.equal(
                release.draft,
                true,
                'Expected our newly created draft'
            );
    }
    return release;
}

export function verifyReleaseAssets(release, metadata, directory) {
    const expected = [metadata.chrome, metadata.firefox];
    assert.equal(
        release.assets.length,
        expected.length,
        'Unexpected release assets'
    );
    for (const name of expected) {
        const bytes = readFileSync(resolve(directory, name));
        const asset = release.assets.find((item) => item.name === name);
        assert.ok(asset, `Missing release asset ${name}`);
        assert.equal(asset.state, 'uploaded', `Incomplete upload: ${name}`);
        assert.equal(asset.size, bytes.length, `Wrong asset size: ${name}`);
        assert.equal(
            asset.digest,
            `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            `Wrong asset digest: ${name}`
        );
    }
}

async function main() {
    const metadata = releaseMetadata(
        JSON.parse(readFileSync('package.json', 'utf8')),
        JSON.parse(readFileSync('package-lock.json', 'utf8'))
    );
    assert.ok(existsSync(metadata.notes), 'Release notes are missing');
    const context = {
        mode: process.env.RELEASE_MODE,
        ref: process.env.GITHUB_REF,
        sha: process.env.GITHUB_SHA,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
    };
    const api = async (path) => {
        assert.ok(
            process.env.GH_TOKEN,
            'GitHub token is required for real releases'
        );
        const response = await fetch(
            `${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}${path}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.GH_TOKEN}`,
                    Accept: 'application/vnd.github+json',
                },
                signal: AbortSignal.timeout(30_000),
            }
        );
        if (response.status === 404) return null;
        assert.ok(response.ok, `GitHub guard failed: HTTP ${response.status}`);
        return response.json();
    };
    const command = process.argv[2];
    assert.ok(
        [
            'preflight',
            'before-release',
            'verify-assets',
            'before-stores',
        ].includes(command),
        'Unknown release command'
    );
    const stage =
        command === 'before-stores'
            ? 'store'
            : command === 'verify-assets'
              ? 'assets'
              : 'new';
    const release = await assertRemoteRelease(context, metadata, api, stage);
    if (stage !== 'new') verifyReleaseAssets(release, metadata, 'packages');
    if (process.env.GITHUB_OUTPUT) {
        for (const [key, value] of Object.entries(metadata))
            appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
    console.log(`Validated ${context.mode}: ${metadata.tag} at ${context.sha}`);
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
