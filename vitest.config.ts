/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        testTimeout: 30000,
        hookTimeout: 30000,
        // Add these include patterns
        include: [
            'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
            'tests/**/*.test.{js,ts}',
            '**/*.{test,spec}.{js,ts}',
        ],
        // Make sure dist folders are excluded
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/dist-chrome/**',
            '**/dist-firefox/**',
            '**/.{idea,git,cache,output,temp}/**',
        ],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
