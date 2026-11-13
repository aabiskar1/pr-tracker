import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const median = (values) => {
    const a = [...values].sort((a, b) => a - b);
    return (
        (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) /
        2
    );
};
const rounded = (n) => +n.toFixed(3);
const stats = (values) => ({
    n: values.length,
    median: rounded(median(values)),
    min: rounded(Math.min(...values)),
    max: rounded(Math.max(...values)),
});
const samples = [
    [
        'browser',
        'variant',
        'prs',
        'repositories',
        'operation',
        'run',
        'key',
        'ui_ms',
        'react_ms',
        'script_ms',
        'style_ms',
        'layout_ms',
        'task_ms',
        'elements',
        'cards',
    ],
];
const summary = {
    base: undefined,
    series: [],
    audits: {},
};
for (const browser of ['chrome', 'firefox'])
    for (const variant of ['baseline', 'profile', 'containment']) {
        const suffix = variant === 'baseline' ? '' : `-${variant}`;
        const data = JSON.parse(
            await fs.readFile(
                path.join(os.tmpdir(), `grouping-${browser}${suffix}.json`),
                'utf8'
            )
        );
        if (variant === 'baseline') {
            const broad = JSON.parse(
                await fs.readFile(
                    path.join(
                        os.tmpdir(),
                        `grouping-${browser}-broad-search.json`
                    ),
                    'utf8'
                )
            );
            if (broad.runs !== 7 || broad.warmup !== 2)
                throw new Error('Refusing broad-search smoke results');
            data.measurements.push(...broad.measurements);
        }
        if (data.runs !== 7 || data.warmup !== 2)
            throw new Error('Refusing to export smoke results');
        const environment = { ...data.environment };
        summary.base ??= environment.base;
        delete environment.temporary;
        const series = {
            browser,
            variant,
            environment,
            warmup: data.warmup,
            runs: data.runs,
            trace: data.traceSummary,
            scenarios: [],
        };
        for (const [count, repositories] of [
            [10, 2],
            [40, 8],
            [100, 20],
            [200, 30],
            [100, 1],
            [200, 1],
        ]) {
            const rows = data.measurements.filter(
                (r) => r.count === count && r.repositories === repositories
            );
            if (!rows.length) continue;
            const scenario = { count, repositories, operations: {} };
            for (const action of [...new Set(rows.map((r) => r.action))]) {
                const originals = rows.filter((r) => r.action === action);
                const observations =
                    action === 'type'
                        ? originals.flatMap((r) => r.keys)
                        : originals;
                scenario.operations[action] = {
                    ui: stats(observations.map((r) => r.ms)),
                    ...(variant === 'profile'
                        ? {
                              react: stats(observations.map((r) => r.reactMs)),
                              commits: stats(
                                  observations.map((r) => r.commits)
                              ),
                          }
                        : {}),
                    ...(originals[0].cpu && action !== 'initial'
                        ? {
                              cpu: Object.fromEntries(
                                  Object.keys(originals[0].cpu).map((k) => [
                                      k,
                                      stats(originals.map((r) => r.cpu[k])),
                                  ])
                              ),
                          }
                        : {}),
                    cards: originals[0].cards,
                    elements: originals[0].elements,
                };
                for (const row of originals) {
                    const cpu = action === 'initial' ? {} : (row.cpu ?? {});
                    samples.push([
                        browser,
                        variant,
                        count,
                        repositories,
                        action === 'type' ? 'type-average' : action,
                        row.run,
                        '',
                        rounded(row.ms),
                        variant === 'profile' ? rounded(row.reactMs) : '',
                        ...[
                            'ScriptDuration',
                            'RecalcStyleDuration',
                            'LayoutDuration',
                            'TaskDuration',
                        ].map((k) =>
                            cpu[k] === undefined ? '' : rounded(cpu[k])
                        ),
                        row.elements,
                        row.cards,
                    ]);
                    if (action === 'type')
                        row.keys.forEach((key, i) =>
                            samples.push([
                                browser,
                                variant,
                                count,
                                repositories,
                                'type-key',
                                row.run,
                                i,
                                rounded(key.ms),
                                variant === 'profile'
                                    ? rounded(key.reactMs)
                                    : '',
                                '',
                                '',
                                '',
                                '',
                                key.elements,
                                key.cards,
                            ])
                        );
                }
            }
            series.scenarios.push(scenario);
        }
        summary.series.push(series);
    }
for (const browser of ['chrome', 'firefox']) {
    const data = JSON.parse(
        await fs.readFile(
            path.join(os.tmpdir(), `grouping-${browser}-audit.json`),
            'utf8'
        )
    );
    summary.audits[browser] = data.audits.map((a) => ({
        case: a.case,
        viewport: a.viewport,
        outer: a.outer,
        overflow: a.overflow,
        clipped: a.clipped?.length,
        scrollHeight: a.scrollHeight,
        top: a.top,
        height: a.height,
        tabStops: a.tabStops,
        links: a.links,
        forcedColours: a.forcedColours,
        header: a.header,
        contrast: a.contrast,
        badges: a.badges?.filter(
            (b, i, all) =>
                all.findIndex(
                    (other) => JSON.stringify(other) === JSON.stringify(b)
                ) === i
        ),
        focus: a.focus && {
            name: a.focus.name,
            tag: a.focus.tag,
            text: a.focus.text?.slice(0, 170),
            style: a.focus.style,
        },
        savedCollapsed: a.saved?.collapsedRepositories.length,
        semanticHeadings:
            a.headings &&
            Object.fromEntries(
                ['H1', 'H2', 'H3'].map((level) => [
                    level,
                    a.headings.filter((h) => h.level === level).length,
                ])
            ),
        validControls: a.disclosures?.every((d) => d.controls),
        groupCount: a.disclosures?.length,
        exactTitleTooltips: a.tooltips
            ?.filter((t) => t.text?.startsWith('needle-'))
            .every((t) => t.text === t.title),
        descriptions: a.descriptions,
    }));
}
const productionLog = await fs.readFile(
    path.join(os.tmpdir(), 'grouping-investigation-chrome-tests.log'),
    'utf8'
);
summary.productionContrast = [
    ...productionLog.matchAll(/PRODUCTION_CONTRAST (\{[^\r\n]+\})/g),
].map((match) => JSON.parse(match[1]));
await fs.writeFile(
    path.join(here, 'samples.csv'),
    samples.map((row) => row.join(',')).join('\n') + '\n'
);
await fs.writeFile(
    path.join(os.tmpdir(), 'grouping-summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
);
console.log(`Exported ${samples.length - 1} observations and summaries`);
