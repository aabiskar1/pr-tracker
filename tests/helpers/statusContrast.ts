import { POPULATED_PRS } from '../e2e/fixtures';

export const STATUS_PRS = [
    ...POPULATED_PRS,
    { ...POPULATED_PRS[0], id: 105, ci_status: 'unknown' as const },
    { ...POPULATED_PRS[0], id: 106, ci_status: 'no-ci' as const },
];

// Self-contained so Chrome evaluation and Firefox's toolbar frame can use it.
// Resolve CSS colours through canvas, including oklch and alpha compositing.
export function measureStatusContrast(doc: Document = document) {
    const view = doc.defaultView!;
    const canvas = doc.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgb = (colour: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const blend = (front: number[], back: number[], opacity = 1) => {
        const alpha = (front[3] / 255) * opacity;
        return back.map((value, i) =>
            i === 3 ? 255 : front[i] * alpha + value * (1 - alpha)
        );
    };
    const background = (element: Element | null): number[] => {
        if (!element) return [255, 255, 255, 255];
        return blend(
            rgb(view.getComputedStyle(element).backgroundColor),
            background(element.parentElement)
        );
    };
    const luminance = (channels: number[]) =>
        channels.slice(0, 3).reduce((sum, value, i) => {
            const s = value / 255;
            return (
                sum +
                (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) *
                    [0.2126, 0.7152, 0.0722][i]
            );
        }, 0);
    const contrast = (a: number[], b: number[]) => {
        const x = luminance(a),
            y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const rows = Array.from(
        doc.querySelectorAll(
            '[data-slot="badge"][data-ci-status], [data-slot="badge"][data-review-status], .popup-draft-badge, .popup-filter-check[data-selected="true"], .ci-advanced-dropdown label'
        )
    ).map((element) => {
        const style = view.getComputedStyle(element);
        const bg = background(element);
        const icons = Array.from(element.querySelectorAll('svg')).map(
            (icon) => {
                const computed = view.getComputedStyle(icon);
                return contrast(
                    blend(rgb(computed.color), bg, Number(computed.opacity)),
                    bg
                );
            }
        );
        return {
            context: element.closest('.filter-bar-container')
                ? 'filter'
                : 'card',
            state:
                element.getAttribute('data-ci-status') ??
                element.getAttribute('data-review-status') ??
                (element.textContent?.trim() || 'checkmark'),
            selected: element.getAttribute('data-selected'),
            foreground: style.color,
            contentColours: Array.from(
                element.querySelectorAll('span, svg')
            ).flatMap((child) => {
                const computed = view.getComputedStyle(child);
                return child.matches('svg')
                    ? [computed.color, computed.fill]
                    : [computed.color];
            }),
            background: style.backgroundColor,
            contrast: contrast(blend(rgb(style.color), bg), bg),
            icons,
        };
    });
    const focused = doc.activeElement;
    const badge = focused?.nextElementSibling;
    const focusStyle = badge && view.getComputedStyle(badge);
    return {
        rows,
        focus:
            focusStyle && badge?.matches('[data-slot="badge"]')
                ? {
                      visible: focused!.matches(':focus-visible'),
                      style: focusStyle.outlineStyle,
                      width: focusStyle.outlineWidth,
                      contrast: contrast(
                          rgb(focusStyle.outlineColor),
                          background(badge.parentElement)
                      ),
                  }
                : null,
    };
}

export function assertStatusContrast(
    audit: ReturnType<typeof measureStatusContrast>
) {
    // Import-free assertion: reused by both browser runners without a test setup.
    if (audit.rows.length < 20)
        throw new Error(`Incomplete status fixture: ${audit.rows.length} rows`);
    for (const row of audit.rows) {
        if (row.state === 'pending' && row.selected !== 'false') {
            if (
                row.background !== 'rgb(148, 98, 0)' ||
                [row.foreground, ...row.contentColours].some(
                    (colour) => colour !== 'rgb(255, 255, 255)'
                )
            )
                throw new Error(
                    `Pending must use white text, icons and separators on the shared amber: ${JSON.stringify(row)}`
                );
        }
        if (row.contrast < 4.5)
            throw new Error(
                `${row.context} ${row.state}: ${row.foreground} on ${row.background} = ${row.contrast}`
            );
        if (row.icons.some((value) => value < 3))
            throw new Error(`Low icon contrast: ${JSON.stringify(row)}`);
    }
}
