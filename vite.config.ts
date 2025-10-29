import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webExtension from '@samrum/vite-plugin-web-extension';
import path from 'path';
import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isFirefox = process.env.BROWSER === 'firefox';
const versionNumber = '1.0.11';
const manifestV2 = {
    manifest_version: 2,
    name: 'PR Tracker',
    version: versionNumber,
    description: 'Track and manage your GitHub pull requests',
    permissions: [
        'storage',
        'notifications',
        'alarms',
        'https://api.github.com/*',
    ],
    browser_specific_settings: {
        gecko: {
            id: '{dabd690e-283a-4c0a-98de-3fc963365d13}',
        },
    },
    background: {
        scripts: ['src/background/index.ts'],
        persistent: false,
    },
    browser_action: {
        default_popup: 'index.html',
        default_icon: {
            '16': 'icons/icon-16.png',
            '32': 'icons/icon-32.png',
            '48': 'icons/icon-48.png',
            '128': 'icons/icon-128.png',
        },
        browser_style: true,
    },
    content_security_policy: "script-src 'self'; object-src 'self';",
    icons: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
    },
};

const manifestV3 = {
    manifest_version: 3,
    name: 'PR Tracker',
    version: versionNumber,
    description: 'Track and manage your GitHub pull requests',
    permissions: ['storage', 'notifications', 'alarms'],
    host_permissions: ['https://api.github.com/*'],
    background: {
        service_worker: 'src/background/index.ts',
        type: 'module',
    },
    action: {
        default_popup: 'index.html',
        default_icon: {
            '16': 'icons/icon-16.png',
            '32': 'icons/icon-32.png',
            '48': 'icons/icon-48.png',
            '128': 'icons/icon-128.png',
        },
    },
    icons: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
    },
};

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        webExtension({
            // @ts-expect-error
            manifest: isFirefox ? manifestV2 : manifestV3,
        }) as any,
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    build: {
        outDir: process.env.BROWSER ? `dist-${process.env.BROWSER}` : 'dist',
        emptyOutDir: true,
    },
});
