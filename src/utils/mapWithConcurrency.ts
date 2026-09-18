type MapWithConcurrencyOptions<TResult> = {
    stopScheduling?: (result: TResult) => boolean;
};

/**
 * Maps items with a fixed number of active workers while retaining input order.
 * When requested, queued items remain unstarted after a completed result meets
 * the stop condition; workers already in progress are allowed to settle.
 */
export async function mapWithConcurrency<TItem, TResult>(
    items: readonly TItem[],
    limit: number,
    worker: (item: TItem, index: number) => Promise<TResult>,
    options: MapWithConcurrencyOptions<TResult> = {}
): Promise<TResult[]> {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('Concurrency limit must be a positive integer');
    }

    const results = new Array<TResult>(items.length);
    let nextIndex = 0;
    let stopScheduling = false;
    let workerFailed = false;
    let workerError: unknown;

    const runWorker = async () => {
        while (!stopScheduling) {
            const index = nextIndex;
            if (index >= items.length) return;
            nextIndex += 1;

            try {
                const result = await worker(items[index]!, index);
                results[index] = result;
                if (options.stopScheduling?.(result)) {
                    stopScheduling = true;
                }
            } catch (error) {
                if (!workerFailed) {
                    workerFailed = true;
                    workerError = error;
                }
                stopScheduling = true;
            }
        }
    };

    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    if (workerFailed) throw workerError;
    return results.slice(0, nextIndex);
}
