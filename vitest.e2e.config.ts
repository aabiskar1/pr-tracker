/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config';
import unitConfig from './vitest.config';

export default mergeConfig(
    unitConfig,
    defineConfig({
        test: {
            setupFiles: ['./tests/e2e/setup.ts'],
        },
    })
);
