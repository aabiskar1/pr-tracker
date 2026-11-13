// One-off investigation runner. Uses existing Vite/Puppeteer, no package changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
}).trim();
const browserName = process.argv[2] ?? 'chrome';
const profile = process.argv.includes('--profile');
const smoke = process.argv.includes('--smoke');
const auditOnly = process.argv.includes('--audit-only');
const containment = process.argv.includes('--content-visibility');
const broadSearch = process.argv.includes('--broad-search');
const output =
    process.env.GROUPING_RESULTS ??
    path.join(
        os.tmpdir(),
        `grouping-${browserName}${profile ? '-profile' : ''}${auditOnly ? '-audit' : ''}${containment ? '-containment' : ''}${broadSearch ? '-broad-search' : ''}.json`
    );
const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'pr-grouping-investigation-')
);
const extension = path.join(temporary, 'extension');
await fs.cp(
    path.join(
        repo,
        '.output',
        browserName === 'firefox' ? 'firefox-mv2' : 'chrome-mv3'
    ),
    extension,
    { recursive: true }
);
await build({
    configFile: false,
    root: repo,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    resolve: {
        alias: [
            {
                find: 'webextension-polyfill',
                replacement: path.join(here, 'memory.ts'),
            },
            {
                find: /.*\/services\/secureStorage$/,
                replacement: path.join(here, 'memory.ts'),
            },
            { find: '@', replacement: repo },
            ...(profile
                ? [
                      {
                          find: 'react-dom/client',
                          replacement: 'react-dom/profiling',
                      },
                  ]
                : []),
        ],
    },
    build: {
        outDir: extension,
        emptyOutDir: false,
        minify: true,
        lib: {
            entry: path.join(here, 'ui.tsx'),
            formats: ['iife'],
            name: 'Investigation',
            fileName: () => 'investigation.js',
        },
    },
});
const assets = await fs.readdir(path.join(extension, 'assets'));
const css = assets.find((name) => name.endsWith('.css'));
await fs.writeFile(
    path.join(extension, 'popup.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PR Tracker investigation</title><link rel="stylesheet" href="assets/${css}">${containment ? '<style>.pr-card-accent { content-visibility:auto; contain-intrinsic-size:auto 9rem; }</style>' : ''}<script defer src="investigation.js"></script></head><body><div id="root"></div></body></html>`
);

let browser, page, call, privileged;
const uuid = '7ae712cf-0000-4000-8000-000000000112';
const extensionId = '{dabd690e-283a-4c0a-98de-3fc963365d13}';
async function until(check) {
    const deadline = Date.now() + 15000;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error('Timed out');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
try {
    if (browserName === 'chrome') {
        browser = await puppeteer.launch({
            headless: false,
            pipe: true,
            args: [
                `--disable-extensions-except=${extension}`,
                `--load-extension=${extension}`,
                '--no-sandbox',
            ],
        });
        const tab = (await browser.pages())[0];
        const session = await tab.createCDPSession();
        const { windowId } = await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { width: 1280, height: 900 },
        });
        const worker = await (
            await browser.waitForTarget(
                (target) => target.type() === 'service_worker'
            )
        ).worker();
        const pending = browser.waitForTarget(
            (target) =>
                target.type() === 'page' && target.url().endsWith('/popup.html')
        );
        await worker.evaluate(() => chrome.action.openPopup());
        page = await (await pending).asPage();
        page.on('pageerror', (error) => console.error('POPUP', String(error)));
        page.on('console', (message) => {
            if (message.type() === 'error')
                console.error('POPUP', message.text());
        });
        await page.waitForFunction(() => !!window.__bench);
        call = (method, args = {}) =>
            page.evaluate(
                async ({ method, args }) => window.__bench[method](args),
                { method, args }
            );
    } else {
        browser = await puppeteer.launch({
            browser: 'firefox',
            executablePath:
                process.env.FIREFOX_PATH ??
                'C:/Program Files/Mozilla Firefox/firefox.exe',
            headless: false,
            env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
            extraPrefsFirefox: {
                'extensions.webextensions.uuids': JSON.stringify({
                    [extensionId]: uuid,
                }),
            },
        });
        await browser.installExtension(extension);
        const connection = browser.connection;
        const tree = await connection.send('browsingContext.getTree', {
            'moz:scope': 'chrome',
        });
        const context = tree.result.contexts[0].context;
        privileged = async (expression) =>
            (
                await connection.send('script.evaluate', {
                    expression,
                    target: { context },
                    awaitPromise: true,
                })
            ).result.result.value;
        await privileged(
            'document.getElementById("unified-extensions-button").click();true'
        );
        await until(
            async () =>
                (await privileged(
                    'document.getElementById("unified-extensions-panel").state'
                )) === 'open'
        );
        await privileged(
            'document.querySelector(\'.webextension-browser-action[label="PR Tracker"]\').click();true'
        );
        await until(
            async () =>
                (await privileged(
                    'document.getElementById("customizationui-widget-panel").state'
                )) === 'open'
        );
        call = async (method, args = {}) => {
            const script = `(async()=>{ try { const value=await content.wrappedJSObject.__bench[${JSON.stringify(method)}](Cu.cloneInto(${JSON.stringify(args)},content)); sendAsyncMessage('investigation-result', JSON.parse(JSON.stringify(value))); } catch(error) {sendAsyncMessage('investigation-result',{error:String(error),stack:error.stack});} })();`;
            const value = await privileged(`new Promise(resolve=>{
                const manager=document.querySelector('#customizationui-widget-panel browser').messageManager;
                const listener=message=>{manager.removeMessageListener('investigation-result',listener);resolve(JSON.stringify(message.data));};
                manager.addMessageListener('investigation-result',listener);
                manager.loadFrameScript('data:application/javascript,'+encodeURIComponent(${JSON.stringify(script)}),false);
            })`);
            const result = JSON.parse(value);
            if (result?.error) throw new Error(JSON.stringify(result));
            return result;
        };
        await until(async () => {
            try {
                return await call('ping');
            } catch {
                return false;
            }
        });
    }
    const environment = {
        browser: await browser.version(),
        node: process.version,
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0].model,
        logicalCpus: os.cpus().length,
        memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
        profile,
        containment,
        headed: true,
        temporary,
        base: sourceCommit,
    };
    const measurements = [];
    const scenarios = auditOnly
        ? []
        : smoke
          ? [[200, 30]]
          : profile || containment
            ? [
                  [200, 30],
                  [200, 1],
              ]
            : [
                  [10, 2],
                  [40, 8],
                  [100, 20],
                  [200, 30],
                  [100, 1],
                  [200, 1],
              ];
    const warmup = smoke ? 1 : 2,
        runs = smoke ? 2 : 7;
    const metricsSession = page ? await page.createCDPSession() : null;
    await metricsSession?.send('Performance.enable');
    async function metrics() {
        return metricsSession
            ? Object.fromEntries(
                  (
                      await metricsSession.send('Performance.getMetrics')
                  ).metrics.map((item) => [item.name, item.value])
              )
            : null;
    }
    for (const [count, repositories] of scenarios) {
        for (const action of broadSearch
            ? ['search-broad']
            : profile || containment
              ? ['view', 'expand', 'type', 'filter']
              : [
                    'initial',
                    'view',
                    'collapse',
                    'expand',
                    'individual',
                    'search',
                    'clear',
                    'type',
                    'filter',
                ]) {
            for (let run = -warmup; run < runs; run++) {
                if (action !== 'initial')
                    await call('prepare', { action, count, repositories });
                const before = await metrics();
                let result;
                if (action === 'initial')
                    result = await call('reset', { count, repositories });
                else if (action === 'type') {
                    const keys = [];
                    for (const value of [
                        'r',
                        're',
                        'rep',
                        'repo',
                        'repos',
                        'repository',
                    ])
                        keys.push(
                            await call('step', { action: 'type', value })
                        );
                    result = {
                        ...keys.at(-1),
                        ms:
                            keys.reduce((sum, item) => sum + item.ms, 0) /
                            keys.length,
                        reactMs:
                            keys.reduce((sum, item) => sum + item.reactMs, 0) /
                            keys.length,
                        keys,
                    };
                } else result = await call('step', { action });
                const after = await metrics();
                if (run >= 0)
                    measurements.push({
                        count,
                        repositories,
                        action,
                        run,
                        ...result,
                        ...(before
                            ? {
                                  cpu: Object.fromEntries(
                                      [
                                          'ScriptDuration',
                                          'LayoutDuration',
                                          'RecalcStyleDuration',
                                          'TaskDuration',
                                      ].map((name) => [
                                          name,
                                          ((after[name] - before[name]) *
                                              1000) /
                                              (action === 'type' ? 6 : 1),
                                      ])
                                  ),
                              }
                            : {}),
                    });
            }
            console.log(
                `${browserName} ${profile ? 'profile ' : ''}${count}/${repositories} ${action}: done`
            );
        }
    }
    const audits = [];
    let traceSummary;
    if (page && !profile && !auditOnly) {
        await call('prepare', {
            action: 'expand',
            count: 200,
            repositories: 30,
        });
        const tracePath = path.join(temporary, 'expand-200-30.trace.json');
        await page.tracing.start({
            path: tracePath,
            categories: ['devtools.timeline', 'blink.user_timing'],
        });
        await call('step', { action: 'expand' });
        await page.tracing.stop();
        const trace = JSON.parse(await fs.readFile(tracePath, 'utf8'));
        traceSummary = Object.fromEntries(
            ['Paint', 'Layout', 'UpdateLayoutTree', 'FunctionCall'].map(
                (name) => {
                    const events = trace.traceEvents.filter(
                        (event) => event.name === name && event.ph === 'X'
                    );
                    return [
                        name,
                        {
                            events: events.length,
                            cpuMs:
                                events.reduce(
                                    (sum, event) => sum + (event.dur ?? 0),
                                    0
                                ) / 1000,
                        },
                    ];
                }
            )
        );
    }
    for (const theme of ['light', 'dark']) {
        await call('reset', {
            count: 200,
            repositories: 30,
            mode: 'repository',
        });
        audits.push({
            case: `200/30 ${theme}`,
            ...(await call('audit', { theme })),
        });
        audits.push({
            case: `200/30 ${theme} bottom`,
            ...(await call('scroll', { position: 1000000 })),
        });
        await call('step', { action: 'collapse' });
        audits.push({
            case: `collapsed ${theme}`,
            ...(await call('focus', { target: 'header' })),
        });
        await call('reset', {
            count: 2,
            repositories: 2,
            mode: 'repository',
            long: true,
        });
        audits.push({
            case: `long ${theme}`,
            ...(await call('audit', { theme })),
        });
        if (page)
            await page.screenshot({
                path: path.join(temporary, `long-${theme}.png`),
            });
    }
    if (page) {
        await call('reset', { count: 10, repositories: 2, mode: 'repository' });
        await call('focus', { target: 'header' });
        await page.keyboard.press('Space');
        audits.push({ case: 'Space', ...(await call('audit')) });
        await page.keyboard.press('Tab');
        audits.push({ case: 'Tab after collapsed', ...(await call('audit')) });
        await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        await page.keyboard.up('Shift');
        await page.keyboard.press('Enter');
        audits.push({ case: 'ShiftTab Enter', ...(await call('audit')) });
        await call('reset', {
            count: 200,
            repositories: 30,
            mode: 'repository',
            collapsed: true,
        });
        await page.focus('[name="search-pull-requests"]');
        await page.type('[name="search-pull-requests"]', 'needle-199:');
        audits.push({ case: 'keyboard search', ...(await call('audit')) });
        await call('step', { action: 'clear' });
        audits.push({ case: 'clear restores', ...(await call('audit')) });
        await metricsSession.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'forced-colors', value: 'active' }],
        });
        await call('focus', { target: 'header' });
        audits.push({ case: 'forced colours', ...(await call('audit')) });
        await page.screenshot({
            path: path.join(temporary, 'forced-colours.png'),
        });
        await metricsSession.send('Emulation.setEmulatedMedia', {
            features: [],
        });
        for (let i = 0; i < 4; i++) {
            await page.keyboard.down('Control');
            await page.keyboard.press('Equal');
            await page.keyboard.up('Control');
        }
        audits.push({
            case: 'Chrome Ctrl+Plus attempt',
            ...(await call('audit')),
        });
    } else {
        await call('reset', {
            count: 2,
            repositories: 2,
            mode: 'repository',
            long: true,
        });
        for (const zoom of [2, 4]) {
            await privileged(
                `document.querySelector('#customizationui-widget-panel browser').browsingContext.fullZoom=${zoom};true`
            );
            const outer = JSON.parse(
                await privileged(
                    `JSON.stringify((()=>{ const b=document.querySelector('#customizationui-widget-panel browser');const r=b.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,screenWidth:screen.availWidth,screenHeight:screen.availHeight};})())`
                )
            );
            audits.push({
                case: `Firefox fullZoom ${zoom}`,
                outer,
                ...(await call('audit')),
            });
            const png = await privileged(
                `(async()=>{const b=document.querySelector('#customizationui-widget-panel browser');const bitmap=await b.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0,0,b.clientWidth,b.clientHeight),1,'white');const canvas=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return canvas.toDataURL();})()`
            );
            await fs.writeFile(
                path.join(temporary, `zoom-${zoom}.png`),
                Buffer.from(png.split(',')[1], 'base64')
            );
        }
        await privileged(
            'document.querySelector("#customizationui-widget-panel browser").browsingContext.fullZoom=1; Services.prefs.setIntPref("browser.display.document_color_use",2);true'
        );
        audits.push({
            case: 'forced colours',
            ...(await call('focus', { target: 'header' })),
        });
    }
    await call('reset', { count: 200, repositories: 1, mode: 'repository' });
    audits.push({ case: '200/1 expanded', ...(await call('audit')) });
    await fs.writeFile(
        output,
        JSON.stringify(
            { environment, warmup, runs, measurements, traceSummary, audits },
            null,
            2
        )
    );
    console.log(`RESULTS ${output}`);
} finally {
    await browser?.close();
}
// Temporary profiles/builds/screenshots remain for inspection; no recursive deletion.
