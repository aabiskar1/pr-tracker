import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Measurement = {
    size: number;
    scenario: string;
    strategy: string;
    requests: number;
    corePrimary: number;
    searchPrimary: number;
    decodedBytes: number;
    syntheticMs: number;
    expectedChanges: number;
    detectedChanges: number;
    notModified: number;
    invalidations: number;
    status: string;
    cooldown: boolean;
    snapshotWritten: boolean;
};

const script = fileURLToPath(
    new URL('../../scripts/measure-incremental-refresh.mjs', import.meta.url)
);
const output = JSON.parse(
    execFileSync(process.execPath, [script], { encoding: 'utf8' })
) as { rows: Measurement[] };
const row = (size: number, scenario: string, strategy: string) => {
    const result = output.rows.find(
        (entry) =>
            entry.size === size &&
            entry.scenario === scenario &&
            entry.strategy === strategy
    );
    if (!result) throw new Error('Missing benchmark row');
    return result;
};

describe('incremental-refresh research benchmark', () => {
    it('covers five sizes, fourteen scenarios, and four isolated strategies', () => {
        expect(output.rows).toHaveLength(280);
        expect(new Set(output.rows.map((entry) => entry.size))).toEqual(
            new Set([5, 20, 40, 100, 150])
        );
    });

    it.each([5, 20, 40, 100, 150])(
        'keeps cold and restarted %i-PR request counts identical',
        (size) => {
            const cold = row(size, 'cold', 'current');
            for (const strategy of ['detail-etag', 'all-etag']) {
                expect(row(size, 'cold', strategy).requests).toBe(
                    cold.requests
                );
                expect(row(size, 'worker-restart', strategy).requests).toBe(
                    cold.requests
                );
                expect(row(size, 'cache-expiry', strategy).requests).toBe(
                    cold.requests
                );
                expect(
                    row(size, 'worker-restart', strategy).invalidations
                ).toBeGreaterThan(0);
            }
        }
    );

    it('keeps HTTP count and conservative latency unchanged for ETag strategies', () => {
        const baseline = row(40, 'warm', 'current');
        const detail = row(40, 'warm', 'detail-etag');
        const all = row(40, 'warm', 'all-etag');
        expect(detail.requests).toBe(baseline.requests);
        expect(all.requests).toBe(baseline.requests);
        expect(detail.syntheticMs).toBe(baseline.syntheticMs);
        expect(all.syntheticMs).toBe(baseline.syntheticMs);
        expect(detail.corePrimary).toBeLessThan(baseline.corePrimary);
        expect(all.corePrimary).toBeLessThan(detail.corePrimary);
        expect(all.searchPrimary).toBe(baseline.searchPrimary);
        expect(detail.decodedBytes).toBeLessThan(baseline.decodedBytes);
        expect(all.decodedBytes).toBeLessThan(detail.decodedBytes);
    });

    it.each(['new-review', 'review-dismissal', 'ci-same-sha'])(
        'exposes an unsafe SHA-skip miss for %s',
        (scenario) => {
            expect(row(40, scenario, 'current').detectedChanges).toBe(1);
            expect(row(40, scenario, 'detail-etag').detectedChanges).toBe(1);
            expect(row(40, scenario, 'all-etag').detectedChanges).toBe(1);
            expect(row(40, scenario, 'unsafe-sha-skip').detectedChanges).toBe(
                0
            );
        }
    );

    it('preserves failure, rate-limit, and cancellation outcomes in safe models', () => {
        for (const strategy of ['current', 'detail-etag', 'all-etag']) {
            const failure = row(40, 'partial-failure', strategy);
            expect(failure.status).toBe('failure');
            expect(failure.snapshotWritten).toBe(false);
            const limit = row(40, 'rate-limit', strategy);
            expect(limit.cooldown).toBe(true);
            expect(limit.snapshotWritten).toBe(true);
            const cancelled = row(40, 'cancellation', strategy);
            expect(cancelled.status).toBe('cancelled');
            expect(cancelled.snapshotWritten).toBe(false);
            expect(cancelled.requests).toBe(8);
        }
    });
});
