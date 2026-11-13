import { Profiler, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dashboard } from '../../../src/components/Dashboard';
import { usePullRequests } from '../../../src/hooks/usePullRequests';
import { appData, POPULATED_PRS } from '../../../tests/e2e/fixtures';
import { snapshot, setSnapshot } from './memory';

const rootElement = document.getElementById('root')!;
let root: Root | undefined;
let commits: number[] = [];
let fixtureCount = 0;
let longFrames: unknown[] = [];
try {
    new PerformanceObserver((list) =>
        longFrames.push(...list.getEntries().map((entry) => entry.toJSON()))
    ).observe({ type: 'long-animation-frame', buffered: false });
} catch {
    /* Firefox does not expose LoAF. */
}

export function Harness() {
    const prs = usePullRequests('fixture-only', 'authenticated');
    const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('light');
    return (
        <Dashboard
            {...prs}
            theme={theme}
            handleThemeChange={(value) => {
                setTheme(value);
                document.documentElement.dataset.theme = value;
            }}
            handleSignOut={() => {}}
        />
    );
}
const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function settle(predicate: () => boolean = () => true) {
    const deadline = performance.now() + 10000;
    do {
        await frame();
        if (performance.now() > deadline)
            throw new Error(
                `UI did not settle: ${cards()} cards; ${document.body.innerText.slice(0, 300)}`
            );
    } while (!predicate());
    await frame();
}
const cards = () => document.querySelectorAll('.pr-card-accent').length;
const groups = () => document.querySelectorAll('.repository-group-toggle');
function button(text: string) {
    return [...document.querySelectorAll('button')].find(
        (item) => item.textContent === text
    )!;
}
function search(value: string) {
    const input = document.querySelector<HTMLInputElement>(
        '[name="search-pull-requests"]'
    )!;
    Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
function view(value: string) {
    const select = document.querySelector<HTMLSelectElement>(
        '[name="pr-grouping"]'
    )!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
}
function fixture(count: number, repositories: number, long: boolean) {
    return Array.from({ length: count }, (_, i) => {
        const name = long
            ? 'repository-'.repeat(9)
            : `repository-${String(i % repositories).padStart(2, '0')}`;
        const owner = long ? (i % 2 ? 'B' : 'A').repeat(39) : 'Acme';
        return {
            ...POPULATED_PRS[i % POPULATED_PRS.length],
            id: 1000 + i,
            title: `needle-${i}: ${long ? 'Exact "long title" & punctuation — '.repeat(20) : 'Keep detailed status, author and reviewer context readable '.repeat(2)}`,
            repository: { name, full_name: `${owner}/${name}` },
            html_url: `https://github.com/${owner}/${name}/pull/${1000 + i}`,
            created_at: '2026-11-01T12:00:00Z',
            updated_at: '2026-11-12T12:00:00Z',
        };
    });
}
async function reset({
    count,
    repositories,
    mode = 'none',
    collapsed = false,
    long = false,
}: {
    count: number;
    repositories: number;
    mode?: 'none' | 'repository';
    collapsed?: boolean;
    long?: boolean;
}) {
    fixtureCount = count;
    const prs = fixture(count, repositories, long);
    const data = appData(prs);
    data.preferences!.grouping = {
        mode,
        collapsedRepositories: collapsed
            ? [
                  ...new Set(
                      prs.map((pr) => pr.repository.full_name.toLowerCase())
                  ),
              ]
            : [],
    };
    root?.unmount();
    setSnapshot(data);
    document.documentElement.dataset.screen = 'prlist';
    document.documentElement.dataset.theme = 'light';
    window.scrollTo(0, 0);
    commits = [];
    longFrames = [];
    const start = performance.now();
    root = createRoot(rootElement);
    root.render(
        <StrictMode>
            <Profiler
                id="dashboard"
                onRender={(_id, _phase, duration) => commits.push(duration)}
            >
                <Harness />
            </Profiler>
        </StrictMode>
    );
    await settle(
        () =>
            cards() === (collapsed && mode === 'repository' ? 0 : count) &&
            !!document.querySelector('h1')
    );
    return result(start);
}
function result(start: number) {
    return {
        ms: performance.now() - start,
        reactMs: commits.reduce((a, b) => a + b, 0),
        commits: commits.length,
        elements:
            document
                .querySelector('[data-testid="repository-groups"]')
                ?.querySelectorAll('*').length ??
            document.querySelectorAll('.pr-card-accent *').length,
        cards: cards(),
        longFrames,
    };
}
async function step({
    action,
    value = '',
}: {
    action: string;
    value?: string;
}) {
    commits = [];
    longFrames = [];
    const start = performance.now();
    let expected = fixtureCount;
    switch (action) {
        case 'view':
            view('repository');
            break;
        case 'collapse':
            button('Collapse all').click();
            expected = 0;
            break;
        case 'expand':
            button('Expand all').click();
            break;
        case 'individual':
            (groups()[0] as HTMLButtonElement).click();
            expected = snapshot.pullRequests.filter(
                (pr) =>
                    pr.repository.full_name?.toLowerCase() ===
                    groups()[0].closest<HTMLElement>('[data-repository-group]')
                        ?.dataset.repositoryGroup
            ).length;
            break;
        case 'search':
            search(`needle-${fixtureCount - 1}:`);
            expected = 1;
            break;
        case 'search-broad':
            search('repository');
            break;
        case 'clear':
            search('');
            expected = 0;
            break;
        case 'type':
            search(value);
            break;
        case 'filter':
            document
                .querySelector<HTMLButtonElement>('[aria-label="Show Drafts"]')!
                .click();
            expected = snapshot.pullRequests.filter((pr) => !pr.draft).length;
            break;
        default:
            throw new Error(`Unknown action: ${action}`);
    }
    await settle(
        () => cards() === expected && (action !== 'view' || groups().length > 0)
    );
    return result(start);
}
async function prepare({
    action,
    count,
    repositories,
}: {
    action: string;
    count: number;
    repositories: number;
}) {
    await reset({
        count,
        repositories,
        mode: action === 'view' || action === 'initial' ? 'none' : 'repository',
        collapsed: [
            'expand',
            'individual',
            'search',
            'search-broad',
            'clear',
        ].includes(action),
    });
    if (action === 'clear') await step({ action: 'search' });
    return true;
}
async function audit({
    theme = document.documentElement.dataset.theme ?? 'light',
}: { theme?: string } = {}) {
    document.documentElement.dataset.theme = theme;
    await settle();
    // Audit settled theme colours, not the existing 200 ms theme transition.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();
    // Inspect final token contrast rather than an interpolated transition colour.
    for (const animation of document.getAnimations()) {
        if (animation instanceof CSSTransition) animation.finish();
    }
    await settle();
    const heading = groups()[0] as HTMLButtonElement | undefined;
    const rect = (element: Element) => {
        const r = element.getBoundingClientRect();
        return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
        };
    };
    const style = (element: Element) => {
        const s = getComputedStyle(element);
        return {
            colour: s.color,
            background: s.backgroundColor,
            border: s.borderColor,
            outline: s.outlineStyle,
            outlineColour: s.outlineColor,
            outlineWidth: s.outlineWidth,
        };
    };
    const scroll = document.scrollingElement!;
    function luminance(colour: string) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        context.fillStyle = colour;
        context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .map((v) => {
                const c = v / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    const contrast = (a: string, b: string) => {
        const x = luminance(a),
            y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const headingStyle = heading && getComputedStyle(heading);
    return {
        viewport: {
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
        },
        theme,
        forcedColours: matchMedia('(forced-colors: active)').matches,
        overflow: scroll.scrollWidth > innerWidth,
        scrollHeight: scroll.scrollHeight,
        headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => ({
            level: h.tagName,
            text: h.textContent,
        })),
        disclosures: [...groups()].map((h) => ({
            name: h.textContent,
            title: h.getAttribute('title'),
            expanded: h.getAttribute('aria-expanded'),
            controls: !!document.getElementById(
                h.getAttribute('aria-controls')!
            ),
            rect: rect(h),
        })),
        clipped: [
            ...document.querySelectorAll(
                '.repository-group-toggle span,.pr-card-title,.grouping-controls'
            ),
        ]
            .filter((e) => {
                const r = e.getBoundingClientRect();
                return r.right > innerWidth + 1 || r.x < 0;
            })
            .map((e) => ({ text: e.textContent, rect: rect(e) })),
        header: heading ? style(heading) : null,
        contrast: headingStyle && {
            name: contrast(headingStyle.color, headingStyle.backgroundColor),
            count: contrast(
                getComputedStyle(heading!.querySelector('span:last-child')!)
                    .color,
                headingStyle.backgroundColor
            ),
            focus: contrast(
                headingStyle.outlineColor,
                headingStyle.backgroundColor
            ),
        },
        badges: [
            ...document.querySelectorAll(
                '[data-ci-status],[data-review-status]'
            ),
        ]
            .slice(0, 8)
            .map((b) => {
                const s = getComputedStyle(b);
                return {
                    label: b.getAttribute('aria-label'),
                    foreground: s.color,
                    background: s.backgroundColor,
                    contrast: contrast(s.color, s.backgroundColor),
                    fontSize: s.fontSize,
                    fontWeight: s.fontWeight,
                };
            }),
        focus: document.activeElement
            ? {
                  tag: document.activeElement.tagName,
                  text: document.activeElement.textContent,
                  name: document.activeElement.getAttribute('name'),
                  style: style(document.activeElement),
                  rect: rect(document.activeElement),
              }
            : null,
        tooltips: [
            ...document.querySelectorAll('.pr-card-title,.popup-repo-badge'),
        ]
            .slice(0, 6)
            .map((e) => ({
                text: e.textContent,
                title: e.getAttribute('title'),
            })),
        descriptions: [...document.querySelectorAll('.pr-card-link')]
            .slice(0, 3)
            .map((e) => e.getAttribute('aria-description')),
        links: document.querySelectorAll('.pr-card-link').length,
        tabStops: document.querySelectorAll(
            'a[href],button:not(:disabled),input,select'
        ).length,
        saved: snapshot.preferences?.grouping,
    };
}
async function focus({ target }: { target: string }) {
    const element =
        target === 'header' ? groups()[0] : document.querySelector(target);
    (element as HTMLElement).focus();
    await settle();
    return audit();
}
async function scroll({ position }: { position: number }) {
    window.scrollTo(0, position);
    await settle();
    return {
        top: scrollY,
        height: document.scrollingElement!.scrollHeight,
        viewport: innerHeight,
    };
}
// Only this temporary popup exports automation hooks. Production entrypoints do not.
Object.assign(window, {
    __bench: { reset, prepare, step, audit, focus, scroll, ping: () => true },
});
