import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repository = 'aabiskar1/pr-tracker';
const chromeId = 'kfeglmkcicfmegclihokchplngcokgil';
const firefoxId = '{dabd690e-283a-4c0a-98de-3fc963365d13}';
const maxAssetSize = 50 * 1024 * 1024;

function validateArchive(file, browser, version, run) {
    run('unzip', ['-t', file], { stdio: 'pipe' });
    const entries = run('unzip', ['-Z1', file], { encoding: 'utf8' })
        .trim()
        .split('\n');
    assert(new Set(entries).size === entries.length, 'Duplicate ZIP entries');
    assert(
        entries.every(
            (entry) =>
                !/(^\/|(^|\/)\.\.(\/|$)|\\|\.(ts|tsx|map)$|(^|\/)(node_modules|tests?|\.git)(\/|$)|(^|\/)\.env[^/]*(\/|$))/i.test(
                    entry
                )
        ),
        'Unsafe or development ZIP contents'
    );
    const manifest = JSON.parse(
        run('unzip', ['-p', file, 'manifest.json'], {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
        })
    );
    assert(
        manifest.version === version && manifest.name === 'PR Tracker',
        'Manifest identity/version mismatch'
    );
    assert(
        manifest.manifest_version === (browser === 'chrome' ? 3 : 2),
        'Incorrect browser manifest format'
    );
    if (browser === 'firefox') {
        assert(
            manifest.browser_specific_settings?.gecko?.id === firefoxId,
            'Firefox extension ID mismatch'
        );
    } else if (manifest.key) {
        const id = createHash('sha256')
            .update(Buffer.from(manifest.key, 'base64'))
            .digest('hex')
            .slice(0, 32)
            .replace(/[0-9a-f]/g, (digit) =>
                String.fromCharCode(97 + parseInt(digit, 16))
            );
        assert(id === chromeId, 'Chrome public key ID mismatch');
    }
    const toolbar =
        manifest.action?.default_icon ||
        manifest.browser_action?.default_icon ||
        {};
    const icons = [
        ...Object.values(manifest.icons || {}),
        ...(typeof toolbar === 'string' ? [toolbar] : Object.values(toolbar)),
        'branding/watchtower.png',
        ...[16, 32, 48, 128].map((size) => `icons/icon-${size}.png`),
    ];
    for (const icon of icons) {
        assert(
            typeof icon === 'string' &&
                entries.includes(icon.replace(/^\//, '')),
            'Missing icon/branding asset'
        );
    }
    const scripts = entries.filter((entry) => entry.endsWith('.js'));
    assert(scripts.length > 0, 'Missing extension JavaScript');
    const javascript = run('unzip', ['-p', file, ...scripts], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
    });
    assert(
        !/TEST_RESET_BACKGROUND_STATE|design-system-showcase/.test(javascript),
        'Test code in production ZIP'
    );
}

// The command runner is injectable so tests can exercise API/download failures
// without live GitHub requests or invoking external tools.
export function validateRelease(
    { tag, store, repo = repository, expectedSnapshot },
    run = execFileSync
) {
    assert(repo === repository, 'Unexpected repository');
    assert(
        /^v\d+\.\d+\.\d+$/.test(tag),
        'Expected a stable vMAJOR.MINOR.PATCH tag'
    );
    assert(['chrome', 'firefox', 'both'].includes(store), 'Invalid store');
    const api = (path) =>
        JSON.parse(
            run('gh', ['api', `repos/${repo}/${path}`], { encoding: 'utf8' })
        );
    const release = api(`releases/tags/${tag}`);
    assert(
        release.tag_name === tag &&
            release.draft === false &&
            release.prerelease === false &&
            release.published_at,
        'Release must be published and stable'
    );
    assert(
        Number.isSafeInteger(release.id) && release.id > 0,
        'Invalid release ID'
    );
    assert(Array.isArray(release.assets), 'Invalid release assets');
    const ref = api(`git/ref/tags/${tag}`);
    assert(ref.ref === `refs/tags/${tag}`, 'Tag mismatch');
    let object = ref.object;
    for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
        assert(/^[a-f0-9]{40}$/.test(object.sha), 'Invalid tag object');
        object = api(`git/tags/${object.sha}`).object;
    }
    assert(
        object.type === 'commit' && /^[a-f0-9]{40}$/.test(object.sha),
        'Tag must resolve to a commit'
    );
    const sha = object.sha;
    assert(api(`commits/${sha}`).sha === sha, 'Commit missing from repository');
    // Historical releases are allowed; do not require latest main.
    assert(
        ['ahead', 'identical'].includes(api(`compare/${sha}...main`).status),
        'Tagged commit must belong to main history'
    );
    if (/^[a-f0-9]{40}$/.test(release.target_commitish)) {
        assert(
            release.target_commitish === sha,
            'Release target differs from tag'
        );
    }
    const contents = api(`contents/package.json?ref=${sha}`);
    assert(contents.encoding === 'base64', 'Unexpected package response');
    assert(
        JSON.parse(Buffer.from(contents.content, 'base64')).version ===
            tag.slice(1),
        'Tagged package version mismatch'
    );
    if (expectedSnapshot !== undefined) {
        assert(
            expectedSnapshot?.id === release.id && expectedSnapshot.sha === sha,
            'Release or tag changed after inspection'
        );
    }

    const snapshot = { id: release.id, sha, assets: {} };
    for (const browser of store === 'both' ? ['chrome', 'firefox'] : [store]) {
        const name = `extension-${browser}.zip`;
        const assets = release.assets.filter((asset) => asset.name === name);
        assert(assets.length === 1, `Expected exactly one ${name}`);
        const asset = assets[0];
        assert(
            Number.isSafeInteger(asset.id) &&
                asset.id > 0 &&
                asset.state === 'uploaded',
            'Invalid asset identity/state'
        );
        assert(
            Number.isSafeInteger(asset.size) &&
                asset.size > 0 &&
                asset.size < maxAssetSize,
            'Invalid asset size'
        );
        assert(
            asset.digest == null || /^sha256:[a-f0-9]{64}$/.test(asset.digest),
            'Unsupported asset digest'
        );
        // Download only original assets by ID from this repository, never an
        // API-provided URL, a rebuilt ZIP, or a workflow artifact.
        const data = run(
            'gh',
            [
                'api',
                `repos/${repo}/releases/assets/${asset.id}`,
                '-H',
                'Accept: application/octet-stream',
            ],
            { maxBuffer: maxAssetSize }
        );
        assert(data.length === asset.size, 'Asset size mismatch');
        const sha256 = createHash('sha256').update(data).digest('hex');
        assert(
            asset.digest == null || asset.digest === `sha256:${sha256}`,
            'Asset SHA-256 mismatch'
        );
        const identity = {
            id: asset.id,
            size: asset.size,
            digest: asset.digest ?? null,
            sha256,
        };
        if (expectedSnapshot !== undefined) {
            assert.deepEqual(
                expectedSnapshot.assets?.[browser],
                identity,
                'Asset changed after inspection'
            );
        }
        writeFileSync(name, data);
        validateArchive(name, browser, tag.slice(1), run);
        snapshot.assets[browser] = identity;
    }
    return snapshot;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        const expected = process.env.EXPECTED_SNAPSHOT;
        // An empty post-approval output must never silently skip revalidation.
        assert(expected !== '', 'Missing inspection snapshot');
        const snapshot = validateRelease({
            tag: process.env.TAG,
            store: process.env.STORE,
            repo: process.env.GITHUB_REPOSITORY,
            expectedSnapshot:
                expected === undefined ? undefined : JSON.parse(expected),
        });
        if (process.env.GITHUB_OUTPUT) {
            appendFileSync(
                process.env.GITHUB_OUTPUT,
                `snapshot=${JSON.stringify(snapshot)}\n`
            );
        }
        for (const [browser, asset] of Object.entries(snapshot.assets)) {
            console.log(`Validated extension-${browser}.zip: ${asset.sha256}`);
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
