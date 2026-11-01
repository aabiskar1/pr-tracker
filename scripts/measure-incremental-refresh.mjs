import assert from 'node:assert/strict';

const SIZES = [5, 20, 40, 100, 150];
const SCENARIOS = [
    'cold',
    'warm',
    'new-review',
    'review-dismissal',
    'new-commit',
    'ci-same-sha',
    'reviewers-change',
    'draft-ready',
    'merged-closed',
    'partial-failure',
    'rate-limit',
    'cancellation',
    'worker-restart',
    'cache-expiry',
];
const STRATEGIES = ['current', 'detail-etag', 'all-etag', 'unsafe-sha-skip'];
const LATENCY_MS = {
    user: 80,
    search: 110,
    detail: 100,
    reviews: 90,
    checks: 120,
    status: 80,
};
const TARGET_ID = 2;
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value));

function fixtures(size) {
    return Array.from({ length: size }, (_, index) => ({
        id: index + 1,
        source: index % 3,
        reviewCount: index % 41 === 0 ? 101 : 3,
        checkCount: index % 37 === 0 ? 0 : index % 29 === 0 ? 145 : 1,
    }));
}

function payload(kind, pr, page, members, version, scenario) {
    if (kind === 'user')
        return {
            login: 'fixture-user',
            avatar_url: 'https://avatars.example/me',
        };
    if (kind === 'search')
        return {
            total_count: members.length,
            incomplete_results: false,
            items: members.map((member) => ({
                id: member.id + 10000,
                title: `Pull request ${member.id}`,
                updated_at: '2026-10-01T00:00:00Z',
                pull_request: {
                    url: `https://api.github.com/repos/fixture/service-${member.id % 4}/pulls/${member.id}`,
                },
            })),
        };
    if (kind === 'detail')
        return {
            id: pr.id,
            title: `Pull request ${pr.id}`,
            state: 'open',
            draft: scenario === 'draft-ready' && pr.id === TARGET_ID,
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-10-01T00:00:00Z',
            requested_reviewers: [
                {
                    login:
                        scenario === 'reviewers-change' && pr.id === TARGET_ID
                            ? 'new-reviewer'
                            : 'fixture-user',
                    avatar_url: 'data:,',
                },
            ],
            user: { login: 'author', avatar_url: 'data:,' },
            head: {
                sha: `fixture-sha-${pr.id}-${scenario === 'new-commit' && pr.id === TARGET_ID ? 2 : 1}`,
            },
            base: {
                repo: {
                    name: 'service',
                    url: 'https://api.github.com/repos/fixture/service',
                },
            },
            body: 'Implementation notes and test details. '.repeat(120),
        };
    if (kind === 'reviews') {
        const count = Math.max(
            0,
            Math.min(
                100,
                pr.reviewCount + (version === 2 ? 1 : 0) - (page - 1) * 100
            )
        );
        return Array.from({ length: count }, (_, index) => ({
            id: (page - 1) * 100 + index + 1,
            user: { id: (index % 3) + 1, login: `reviewer-${(index % 3) + 1}` },
            state:
                version === 2 && index === count - 1
                    ? 'CHANGES_REQUESTED'
                    : pr.id === TARGET_ID && index === pr.reviewCount - 1
                      ? version === 3
                          ? 'DISMISSED'
                          : 'APPROVED'
                      : 'COMMENTED',
            submitted_at: '2026-10-01T12:00:00Z',
            body: 'Sanitized review feedback. '.repeat(8),
        }));
    }
    if (kind === 'checks') {
        const count = Math.max(
            0,
            Math.min(100, pr.checkCount - (page - 1) * 100)
        );
        return {
            total_count: pr.checkCount,
            check_runs: Array.from({ length: count }, (_, index) => ({
                id: (page - 1) * 100 + index + 1,
                name: `test-${index}`,
                status: 'completed',
                conclusion: version === 2 ? 'failure' : 'success',
                output: { summary: 'Sanitized check output. '.repeat(6) },
            })),
        };
    }
    return {
        state: version === 2 ? 'failure' : 'success',
        total_count: 1,
        statuses: [{ state: 'success', context: 'legacy-ci' }],
    };
}

function seedCache(prs) {
    const cache = new Map();
    for (const pr of prs) {
        cache.set(`detail:${pr.id}`, 1);
        for (let page = 1; page <= Math.ceil(pr.reviewCount / 100); page++)
            cache.set(`reviews:${pr.id}:${page}`, 1);
        for (
            let page = 1;
            page <= Math.max(1, Math.ceil(pr.checkCount / 100));
            page++
        )
            cache.set(`checks:${pr.id}:1:${page}`, 1);
        if (pr.checkCount === 0) cache.set(`status:${pr.id}:1`, 1);
    }
    return cache;
}

function simulate(size, scenario, strategy) {
    const allPrs = fixtures(size);
    const activePrs =
        scenario === 'merged-closed'
            ? allPrs.filter((pr) => pr.id !== TARGET_ID)
            : allPrs;
    const cache =
        scenario === 'cold' || strategy === 'current'
            ? new Map()
            : seedCache(allPrs);
    let invalidations = 0;
    if (scenario === 'worker-restart' || scenario === 'cache-expiry') {
        invalidations = cache.size;
        cache.clear();
    }
    let requests = 0;
    let corePrimary = 0;
    let searchPrimary = 0;
    let decodedBytes = 0;
    let notModified = 0;
    let detected = 0;
    let skipped = 0;
    const metrics = {
        status: 'success',
        cooldown: false,
        snapshotWritten: true,
    };
    const changedDetail = [
        'new-commit',
        'reviewers-change',
        'draft-ready',
    ].includes(scenario);
    const changedReview = ['new-review', 'review-dismissal'].includes(scenario);
    const changedChecks = scenario === 'ci-same-sha';
    const conditional = (kind) =>
        (strategy === 'all-etag' &&
            ['detail', 'reviews', 'checks', 'status'].includes(kind)) ||
        (strategy === 'detail-etag' && kind === 'detail');
    const request = (
        kind,
        key,
        pr,
        page,
        members,
        version = 1,
        fault = null
    ) => {
        requests++;
        if (fault) {
            if (kind === 'search') searchPrimary++;
            else corePrimary++;
            decodedBytes += byteLength({ message: fault });
            return LATENCY_MS[kind];
        }
        const cachedVersion = cache.get(key);
        const unchanged = conditional(kind) && cachedVersion === version;
        if (unchanged) {
            notModified++;
        } else {
            if (kind === 'search') searchPrimary++;
            else corePrimary++;
            decodedBytes += byteLength(
                payload(kind, pr, page, members, version, scenario)
            );
            if (conditional(kind)) {
                if (cachedVersion !== undefined && cachedVersion !== version)
                    invalidations++;
                cache.set(key, version);
            }
        }
        if (pr?.id === TARGET_ID && version > 1 && !unchanged) detected = 1;
        return LATENCY_MS[kind];
    };

    let elapsedMs = request('user', 'user', null, 1, null);
    const searches = [0, 1, 2].map((source) => {
        const members = activePrs.filter((pr) =>
            scenario === 'reviewers-change' && pr.id === TARGET_ID
                ? source === 2
                : pr.source === source
        );
        let queryMs = 0;
        for (
            let page = 1;
            page <= Math.max(1, Math.ceil(members.length / 100));
            page++
        )
            queryMs += request(
                'search',
                `search:${source}:${page}`,
                null,
                page,
                members.slice((page - 1) * 100, page * 100)
            );
        return queryMs;
    });
    elapsedMs += Math.max(...searches);
    if (scenario === 'merged-closed') detected = 1;
    if (scenario === 'cancellation') {
        for (const pr of activePrs.slice(0, 4))
            request('detail', `detail:${pr.id}`, pr, 1, null);
        metrics.status = 'cancelled';
        metrics.snapshotWritten = false;
        elapsedMs += LATENCY_MS.detail;
    } else {
        const workers = [0, 0, 0, 0];
        for (const pr of activePrs) {
            const worker = workers.indexOf(Math.min(...workers));
            const detailVersion = changedDetail && pr.id === TARGET_ID ? 2 : 1;
            const detailFailure =
                scenario === 'partial-failure' && pr.id === TARGET_ID;
            const detailMs = request(
                'detail',
                `detail:${pr.id}`,
                pr,
                1,
                null,
                detailVersion,
                detailFailure ? 'unavailable' : null
            );
            if (detailFailure) {
                metrics.status = 'failure';
                metrics.snapshotWritten = false;
                workers[worker] += detailMs;
                continue;
            }
            if (
                strategy === 'unsafe-sha-skip' &&
                scenario !== 'cold' &&
                scenario !== 'worker-restart' &&
                scenario !== 'cache-expiry' &&
                detailVersion === 1
            ) {
                skipped += 2;
                workers[worker] += detailMs;
                continue;
            }
            let reviewMs = 0;
            for (
                let page = 1;
                page <= Math.ceil(pr.reviewCount / 100);
                page++
            ) {
                const failed =
                    scenario === 'rate-limit' &&
                    pr.id === TARGET_ID &&
                    page === 1;
                reviewMs += request(
                    'reviews',
                    `reviews:${pr.id}:${page}`,
                    pr,
                    page,
                    null,
                    changedReview && pr.id === TARGET_ID
                        ? scenario === 'review-dismissal'
                            ? 3
                            : 2
                        : 1,
                    failed ? 'secondary rate limit' : null
                );
                if (failed) {
                    metrics.cooldown = true;
                    break;
                }
            }
            const shaVersion =
                scenario === 'new-commit' && pr.id === TARGET_ID ? 2 : 1;
            let ciMs = 0;
            for (
                let page = 1;
                page <= Math.max(1, Math.ceil(pr.checkCount / 100));
                page++
            )
                ciMs += request(
                    'checks',
                    `checks:${pr.id}:${shaVersion}:${page}`,
                    pr,
                    page,
                    null,
                    changedChecks && pr.id === TARGET_ID ? 2 : 1
                );
            if (pr.checkCount === 0)
                ciMs += request(
                    'status',
                    `status:${pr.id}:${shaVersion}`,
                    pr,
                    1,
                    null
                );
            workers[worker] += detailMs + Math.max(reviewMs, ciMs);
        }
        elapsedMs += Math.max(...workers);
    }
    if (metrics.status !== 'success') detected = 0;
    const expectedChanges = [
        'new-review',
        'review-dismissal',
        'new-commit',
        'ci-same-sha',
        'reviewers-change',
        'draft-ready',
        'merged-closed',
    ].includes(scenario)
        ? 1
        : 0;
    return {
        size,
        scenario,
        strategy,
        requests,
        corePrimary,
        searchPrimary,
        decodedBytes,
        syntheticMs: elapsedMs,
        expectedChanges,
        detectedChanges: detected,
        notModified,
        invalidations,
        skipped,
        ...metrics,
    };
}

const rows = SIZES.flatMap((size) =>
    SCENARIOS.flatMap((scenario) =>
        STRATEGIES.map((strategy) => simulate(size, scenario, strategy))
    )
);
const target = fixtures(5)[1];
const baselineDetail = payload('detail', target, 1, null, 1, 'warm');
assert.equal(
    payload('detail', target, 1, null, 2, 'reviewers-change').head.sha,
    baselineDetail.head.sha
);
assert.equal(
    payload('detail', target, 1, null, 2, 'draft-ready').head.sha,
    baselineDetail.head.sha
);
assert.equal(
    payload('detail', target, 1, null, 2, 'reviewers-change')
        .requested_reviewers[0].login,
    'new-reviewer'
);
assert.equal(payload('detail', target, 1, null, 2, 'draft-ready').draft, true);
assert.equal(
    payload('reviews', target, 1, null, 1, 'warm').at(-1).state,
    'APPROVED'
);
assert.equal(
    payload('reviews', target, 1, null, 2, 'new-review').at(-1).state,
    'CHANGES_REQUESTED'
);
assert.equal(
    payload('reviews', target, 1, null, 3, 'review-dismissal').at(-1).state,
    'DISMISSED'
);
for (const size of SIZES) {
    for (const scenario of SCENARIOS) {
        const group = rows.filter(
            (row) => row.size === size && row.scenario === scenario
        );
        assert.equal(group.length, STRATEGIES.length);
        for (const row of group.slice(0, 3)) {
            assert.equal(row.detectedChanges, row.expectedChanges);
            assert.equal(row.status, group[0].status);
            assert.equal(row.snapshotWritten, group[0].snapshotWritten);
        }
        assert.equal(group[0].requests, group[1].requests);
        assert.equal(group[0].requests, group[2].requests);
    }
}
assert.equal(rows.length, 280);
for (const scenario of ['new-review', 'review-dismissal', 'ci-same-sha'])
    assert.equal(simulate(40, scenario, 'unsafe-sha-skip').detectedChanges, 0);

const result = {
    methodology:
        'Deterministic endpoint simulator, not production fetcher or live GitHub timing',
    latency:
        'Virtual milliseconds with equal 200/304 endpoint delays and four PR workers',
    bytes: 'UTF-8 JSON fixture bodies delivered to JavaScript; excludes headers and compression',
    primary:
        'Hypothetical correctly authorized 304 costs zero primary units; search and user are unconditional',
    sizes: SIZES,
    scenarios: SCENARIOS,
    strategies: STRATEGIES,
    rows,
};
if (process.argv.includes('--summary')) {
    for (const size of SIZES)
        for (const scenario of [
            'cold',
            'warm',
            'new-review',
            'ci-same-sha',
            'worker-restart',
        ])
            for (const strategy of STRATEGIES) {
                const row = rows.find(
                    (entry) =>
                        entry.size === size &&
                        entry.scenario === scenario &&
                        entry.strategy === strategy
                );
                console.log(
                    [
                        size,
                        scenario,
                        strategy,
                        row.requests,
                        row.corePrimary,
                        row.searchPrimary,
                        row.decodedBytes,
                        row.syntheticMs,
                        `${row.detectedChanges}/${row.expectedChanges}`,
                    ].join('\t')
                );
            }
} else {
    console.log(JSON.stringify(result, null, 2));
}
