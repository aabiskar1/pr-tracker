import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { build } from 'vite';

if (process.env.PR_TRACKER_MEASURE_LIVE !== '1') {
    throw new Error(
        'Live measurement requires PR_TRACKER_MEASURE_LIVE=1; never run in automated tests'
    );
}

// Use an existing credential in memory. Never print it or write it to disk.
const token = execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    windowsHide: true,
}).trim();
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
        ssr: 'src/experiments/githubGraphql/liveMeasurement.ts',
        outDir: '.output/graphql-measurement',
        rollupOptions: { output: { entryFileNames: 'runner.mjs' } },
    },
});
const { measureLive } =
    await import('../.output/graphql-measurement/runner.mjs');
const result = await measureLive(token);
const output = '.output/graphql-measurement/results.json';
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Aggregate measurement results saved to ${output}`);
