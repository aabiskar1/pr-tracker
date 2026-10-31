// Reuses PR #99's Vite browser-boundary harness and instrumentTransport.
// Fixture mode never reads credentials. Live mode needs BOTH --live and opt-in.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { build } from 'vite';
const live = process.argv.includes('--live');
if (process.argv.includes('--diagnose') && !live)
    throw new Error('Diagnostics require explicit --live opt-in');
if (live && process.env.PR_TRACKER_HYBRID_LIVE !== '1')
    throw new Error(
        'Live benchmark requires PR_TRACKER_HYBRID_LIVE=1 and --live'
    );
await build({
    configFile: false,
    ssr: { noExternal: ['webextension-polyfill'] },
    logLevel: 'error',
    plugins: [
        {
            name: 'measurement-browser-boundary',
            enforce: 'pre',
            resolveId(id) {
                if (id === 'webextension-polyfill')
                    return '\0measurement-browser';
            },
            load(id) {
                if (id === '\0measurement-browser')
                    return 'export default { runtime: { sendMessage: async () => undefined } };';
            },
        },
    ],
    build: {
        ssr: 'src/experiments/hybridMetadata/runner.ts',
        outDir: '.output/hybrid-measurement',
        rollupOptions: { output: { entryFileNames: 'runner.mjs' } },
    },
});
const { benchmarkFixtures, benchmarkLive, diagnoseLiveMetadata } =
    await import('../.output/hybrid-measurement/runner.mjs');
let result;
if (live) {
    const token = execFileSync('gh', ['auth', 'token'], {
        encoding: 'utf8',
        windowsHide: true,
    }).trim();
    try {
        result = process.argv.includes('--diagnose')
            ? await diagnoseLiveMetadata(token, {
                  open: process.argv.includes('--open'),
              })
            : await benchmarkLive(token, {
                  open: process.argv.includes('--open'),
                  sizes: process.env.PR_TRACKER_HYBRID_LIVE_SIZES?.split(
                      ','
                  ).map(Number) ?? [40],
              });
    } catch {
        throw new Error(
            'Read-only live benchmark failed; no credentials or upstream response content logged'
        );
    }
} else {
    result = await benchmarkFixtures({
        restDelayMs: 5,
        graphqlDelayMs: 8,
        repeats: 3,
    });
    result.batchStudy = [];
    for (const batchSize of [10, 20, 40, 50]) {
        const trial = await benchmarkFixtures({
            sizes: [40],
            repeats: 1,
            restDelayMs: 5,
            graphqlDelayMs: 8,
            batchSize,
        });
        result.batchStudy.push({ batchSize, ...trial.trials[0] });
    }
    result.failureStudy = [];
    for (const fault of [
        'partial',
        'network',
        'timeout',
        'rate-limit',
        'missing-detail',
        'incomplete-search',
    ]) {
        const trial = await benchmarkFixtures({
            sizes: [40],
            repeats: 1,
            fault,
        });
        result.failureStudy.push({ fault, ...trial.trials[0] });
    }
}
result.environment = {
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
};
const output = `.output/hybrid-measurement/${process.argv.includes('--diagnose') ? 'diagnostics' : live ? 'live' : 'fixtures'}.json`;
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Aggregate hybrid measurements saved to ${output}`);
