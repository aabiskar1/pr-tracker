// Opt-in, read-only public PR sample. Never logs response bodies or credentials.
import fs from 'node:fs';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';

if (process.env.PR_TRACKER_CACHE_LIVE !== '1') {
    throw new Error('Set PR_TRACKER_CACHE_LIVE=1 to run authenticated GETs');
}
const token =
    process.env.PR_TRACKER_CACHE_CREDENTIAL === 'gh'
        ? spawnSync('gh', ['auth', 'token'], {
              encoding: 'utf8',
          }).stdout?.trim()
        : process.env.GITHUB_TOKEN ||
          (fs.existsSync('.env.test') &&
              parse(fs.readFileSync('.env.test')).GITHUB_TOKEN);
if (!token) throw new Error('No configured GitHub token');

async function get(path, etag) {
    const started = performance.now();
    return new Promise((resolve, reject) => {
        const request = https.get(
            {
                hostname: 'api.github.com',
                path,
                headers: {
                    Authorization: `token ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                    'Accept-Encoding': 'identity',
                    'User-Agent': 'PR-Tracker-cache-validation',
                    ...(etag ? { 'If-None-Match': etag } : {}),
                },
            },
            (response) => {
                let bytes = 0;
                response.on('data', (chunk) => {
                    bytes += chunk.length;
                });
                response.on('end', () =>
                    resolve({
                        status: response.statusCode,
                        bytes,
                        ms: performance.now() - started,
                        etag: response.headers.etag,
                        encoding:
                            response.headers['content-encoding'] ?? 'identity',
                        remaining: Number(
                            response.headers['x-ratelimit-remaining']
                        ),
                        used: Number(response.headers['x-ratelimit-used']),
                        reset: Number(response.headers['x-ratelimit-reset']),
                        resource: response.headers['x-ratelimit-resource'],
                    })
                );
            }
        );
        request.setTimeout(15000, () =>
            request.destroy(new Error('Request timed out'))
        );
        request.on('error', () =>
            reject(
                new Error('GitHub request failed; no credential details logged')
            )
        );
    });
}

let previous = await get('/user');
if (previous.status !== 200) {
    console.log(
        JSON.stringify({ authenticated: false, status: previous.status })
    );
    process.exitCode = 1;
} else {
    const rows = [];
    for (let round = 1; round <= 3; round++) {
        for (const pr of [103, 104, 105, 106, 107]) {
            let etag;
            for (const phase of ['cold', 'warm']) {
                const result = await get(
                    `/repos/aabiskar1/pr-tracker/pulls/${pr}`,
                    etag
                );
                const comparable =
                    result.resource === previous.resource &&
                    result.reset === previous.reset;
                rows.push({
                    round,
                    pr,
                    phase,
                    ...result,
                    etag: Boolean(result.etag),
                    remainingDelta: comparable
                        ? previous.remaining - result.remaining
                        : null,
                    usedDelta: comparable ? result.used - previous.used : null,
                });
                etag = result.etag;
                previous = result;
                if (result.status !== 200 && result.status !== 304) {
                    console.log(
                        JSON.stringify({
                            authenticated: true,
                            stopped: true,
                            rows,
                        })
                    );
                    process.exit(1);
                }
                // A small, paced sample; secondary rate limits still apply.
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
    }
    console.log(
        JSON.stringify(
            { authenticated: true, requests: rows.length + 1, rows },
            null,
            2
        )
    );
}
