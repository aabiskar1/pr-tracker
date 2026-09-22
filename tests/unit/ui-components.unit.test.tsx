import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from '../../src/components/ui/badge';
import { Button } from '../../src/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '../../src/components/ui/card';
import { Input } from '../../src/components/ui/input';
import { Separator } from '../../src/components/ui/separator';
import { Skeleton } from '../../src/components/ui/skeleton';
import { cn } from '../../src/lib/utils';

describe('design-system utilities', () => {
    it('merges conditional classes and resolves Tailwind conflicts', () => {
        expect(cn('px-2', { hidden: false }, ['px-4', 'text-sm'])).toBe(
            'px-4 text-sm'
        );
    });
});

describe('Button', () => {
    it.each([
        ['default', 'bg-primary'],
        ['secondary', 'bg-secondary'],
        ['outline', 'border-input'],
        ['ghost', 'hover:bg-accent'],
        ['destructive', 'bg-destructive'],
    ] as const)('provides the %s variant', (variant, expectedClass) => {
        const html = renderToStaticMarkup(
            createElement(Button, { variant }, 'Action')
        );

        expect(html).toContain(expectedClass);
    });

    it('supports disabled and accessibly named icon-only buttons', () => {
        const html = renderToStaticMarkup(
            createElement(
                Button,
                {
                    size: 'icon',
                    disabled: true,
                    'aria-label': 'Refresh pull requests',
                },
                '↻'
            )
        );

        expect(html).toContain('data-slot="button"');
        expect(html).toContain('aria-label="Refresh pull requests"');
        expect(html).toContain('disabled=""');
        expect(html).toContain('size-control');
        expect(html).toContain('focus-visible:ring-3');
    });
});

describe('Badge', () => {
    it.each([
        ['ciPassing', 'bg-ci-passing'],
        ['ciFailing', 'bg-ci-failing'],
        ['ciPending', 'bg-ci-pending'],
        ['reviewApproved', 'bg-review-approved'],
        ['reviewChanges', 'bg-review-changes'],
        ['reviewAwaiting', 'bg-review-awaiting'],
        ['draft', 'bg-status-draft'],
        ['unavailable', 'bg-status-unavailable'],
    ] as const)(
        'provides the semantic %s variant',
        (variant, expectedClass) => {
            const html = renderToStaticMarkup(
                createElement(Badge, { variant }, 'Status')
            );

            expect(html).toContain(expectedClass);
        }
    );

    it('renders status text independently from its colour', () => {
        const html = renderToStaticMarkup(
            createElement(Badge, { variant: 'ciPassing' }, 'CI passing')
        );

        expect(html).toContain('CI passing');
        expect(html).toContain('text-ci-passing-foreground');
    });
});

describe('Card, Input, Separator, and Skeleton', () => {
    it('exposes composable card slots', () => {
        const html = renderToStaticMarkup(
            createElement(
                Card,
                null,
                createElement(
                    CardHeader,
                    null,
                    createElement(CardTitle, null, 'Pull request'),
                    createElement(CardDescription, null, 'Needs review')
                ),
                createElement(CardContent, null, 'Content'),
                createElement(CardFooter, null, 'Footer')
            )
        );

        for (const slot of [
            'card',
            'card-header',
            'card-title',
            'card-description',
            'card-content',
            'card-footer',
        ]) {
            expect(html).toContain(`data-slot="${slot}"`);
        }
    });

    it('passes accessible input labels and error state attributes through', () => {
        const html = renderToStaticMarkup(
            createElement(Input, {
                'aria-label': 'Search pull requests',
                'aria-invalid': true,
                disabled: true,
            })
        );

        expect(html).toContain('aria-label="Search pull requests"');
        expect(html).toContain('aria-invalid="true"');
        expect(html).toContain('disabled=""');
        expect(html).toContain('aria-invalid:border-destructive');
    });

    it('supports meaningful and decorative separators', () => {
        const meaningful = renderToStaticMarkup(
            createElement(Separator, {
                decorative: false,
                orientation: 'vertical',
            })
        );
        const decorative = renderToStaticMarkup(createElement(Separator));

        expect(meaningful).toContain('role="separator"');
        expect(meaningful).toContain('aria-orientation="vertical"');
        expect(meaningful).toContain('h-full w-px');
        expect(decorative).toContain('role="none"');
    });

    it('marks skeletons as presentational and respects reduced motion', () => {
        const html = renderToStaticMarkup(createElement(Skeleton));

        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('motion-reduce:animate-none');
    });
});
