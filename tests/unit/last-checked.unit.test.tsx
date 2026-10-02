import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LastChecked } from '../../src/components/LastChecked';

const NOW = new Date('2030-06-07T12:00:00.000Z');

describe('Checked indicator', () => {
    afterEach(() => vi.useRealTimers());

    it.each([
        [undefined, 'Not checked yet'],
        ['invalid', 'Not checked yet'],
        ['2030-06-07T12:00:00.000Z', 'Checked just now'],
        ['2030-06-07T11:59:01.000Z', 'Checked just now'],
        ['2030-06-07T11:57:00.000Z', 'Checked 3 min ago'],
        ['2030-06-07T11:00:00.000Z', 'Checked 1 hr ago'],
        ['2030-06-06T12:00:00.000Z', 'Checked yesterday'],
        ['2030-06-04T12:00:00.000Z', 'Checked 3 days ago'],
        ['2030-06-07T12:01:00.000Z', 'Checked just now'],
    ])('renders %s as %s', (timestamp, expected) => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const html = renderToStaticMarkup(
            createElement(LastChecked, { lastSuccessfulRefreshAt: timestamp })
        );
        expect(html).toContain(`>${expected}</span>`);
        expect(html).toContain(
            `aria-label="${expected === 'Not checked yet' ? expected : `Last ${expected.toLowerCase()}`}"`
        );
        if (timestamp && timestamp !== 'invalid') {
            expect(html).toContain(
                `title="Last checked ${new Date(timestamp).toLocaleString()}"`
            );
        } else {
            expect(html).not.toContain('title=');
        }
    });
});
