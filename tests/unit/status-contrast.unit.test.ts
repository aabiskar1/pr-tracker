import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    new URL('../../src/styles/tokens.css', import.meta.url),
    'utf8'
);
const light = css.slice(
    css.indexOf("[data-theme='light']"),
    css.indexOf("[data-theme='dark']")
);
const dark = css.slice(
    css.indexOf("[data-theme='dark']"),
    css.indexOf('@theme')
);
const tokens = (source: string) =>
    Object.fromEntries(
        Array.from(source.matchAll(/(--[\w-]+):\s*([^;]+);/g), (match) => [
            match[1],
            match[2].trim(),
        ])
    );

function contrast(foreground: string, background: string) {
    const luminance = (hex: string) => {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
        return [0, 2, 4].reduce((sum, offset, i) => {
            const value = parseInt(hex.slice(offset + 1, offset + 3), 16) / 255;
            return (
                sum +
                (value <= 0.04045
                    ? value / 12.92
                    : ((value + 0.055) / 1.055) ** 2.4) *
                    [0.2126, 0.7152, 0.0722][i]
            );
        }, 0);
    };
    const a = luminance(foreground),
        b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(['light', 'dark'] as const)('%s status colours', (theme) => {
    const values = {
        ...tokens(light),
        ...(theme === 'dark' ? tokens(dark) : {}),
    };
    const resolve = (name: string): string => {
        expect(values[name], name).toBeDefined();
        const variable = values[name].match(/^var\((--[\w-]+)\)$/);
        return variable ? resolve(variable[1]) : values[name];
    };
    const pairs = [
        ...[
            'ci-passing',
            'ci-failing',
            'ci-pending',
            'review-approved',
            'review-changes',
            'review-awaiting',
            'status-draft',
            'status-unavailable',
            'secondary',
        ].map((name) => [name, `${name}-foreground`]),
        ['popup-status-passing', 'popup-status-foreground'],
        ['popup-status-failing', 'popup-status-foreground'],
        ['popup-status-pending', 'popup-status-pending-foreground'],
        ['popup-card-status-passing', 'popup-card-status-foreground'],
        ['popup-card-status-failing', 'popup-card-status-foreground'],
        ['popup-card-status-pending', 'popup-status-pending-foreground'],
        ['popup-draft', 'popup-draft-foreground'],
        ['popup-surface', 'foreground'],
        ['popup-surface', 'popup-filter-foreground'],
    ];
    it.each(pairs)(
        'keeps normal text on %s at 4.5:1',
        (background, foreground) => {
            expect(
                contrast(resolve(`--${foreground}`), resolve(`--${background}`))
            ).toBeGreaterThanOrEqual(4.5);
        }
    );
    it('uses the same white-on-yellow Pending pair for cards and active filters', () => {
        expect(resolve('--popup-status-pending')).toBe('#927206');
        expect(resolve('--popup-card-status-pending')).toBe(
            resolve('--popup-status-pending')
        );
        expect(resolve('--popup-status-pending-foreground')).toBe('#ffffff');
    });
    it('keeps the focus outline visible against the filter surface', () => {
        expect(
            contrast(resolve('--ring'), resolve('--popup-surface'))
        ).toBeGreaterThanOrEqual(3);
    });
});
