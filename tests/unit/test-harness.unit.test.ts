import { describe, expect, it } from 'vitest';
import e2eConfig from '../../vitest.e2e.config';
import unitConfig from '../../vitest.config';

const setupFiles = (config: typeof unitConfig) => config.test?.setupFiles;

describe('Vitest harness ownership', () => {
    it('keeps the pure unit configuration free of browser setup', () => {
        expect(setupFiles(unitConfig)).toBeUndefined();
    });

    it('assigns packaged-browser setup only to the E2E configuration', () => {
        expect(setupFiles(e2eConfig)).toEqual(['./tests/e2e/setup.ts']);
    });
});
