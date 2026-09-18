import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../src/utils/mapWithConcurrency';

const deferred = <T = void>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

describe('mapWithConcurrency', () => {
    it('preserves input association while limiting active workers', async () => {
        const gates = Array.from({ length: 5 }, () => deferred());
        const firstTwoStarted = deferred();
        const thirdStarted = deferred();
        const started: number[] = [];
        let active = 0;
        let maxActive = 0;

        const resultPromise = mapWithConcurrency(
            [1, 2, 3, 4, 5],
            2,
            async (item, index) => {
                started.push(item);
                active += 1;
                maxActive = Math.max(maxActive, active);
                if (started.length === 2) firstTwoStarted.resolve();
                if (item === 3) thirdStarted.resolve();
                await gates[index].promise;
                active -= 1;
                return item * 10;
            }
        );

        await firstTwoStarted.promise;
        expect(started).toEqual([1, 2]);
        gates[0].resolve();
        await thirdStarted.promise;
        expect(started).toEqual([1, 2, 3]);
        gates.forEach((gate) => gate.resolve());

        await expect(resultPromise).resolves.toEqual([10, 20, 30, 40, 50]);
        expect(maxActive).toBe(2);
    });

    it('settles active workers and can be reused after a worker rejects', async () => {
        const firstWorker = deferred();
        const secondWorker = deferred();
        const started: number[] = [];

        const failedResult = mapWithConcurrency([1, 2, 3], 2, async (item) => {
            started.push(item);
            if (item === 1) await firstWorker.promise;
            if (item === 2) await secondWorker.promise;
            return item;
        });

        firstWorker.reject(new Error('worker failed'));
        secondWorker.resolve();
        await expect(failedResult).rejects.toThrow('worker failed');
        expect(started).toEqual([1, 2]);

        await expect(
            mapWithConcurrency([3, 1, 2], 2, async (item) => item * 2)
        ).resolves.toEqual([6, 2, 4]);
    });

    it('rejects an invalid concurrency limit', async () => {
        await expect(
            mapWithConcurrency([1], 0, async (item) => item)
        ).rejects.toThrow('positive integer');
    });
});
