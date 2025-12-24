import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import packageJson from './package.json';

export default defineConfig({
    modules: ['@wxt-dev/module-react'],
    manifest: {
        name: 'PR Tracker',
        description: 'Track and manage your GitHub pull requests',
        version: packageJson.version,
        permissions: ['storage', 'notifications', 'alarms'],
        host_permissions: ['https://api.github.com/*'],
        browser_specific_settings: {
            gecko: {
                id: '{dabd690e-283a-4c0a-98de-3fc963365d13}',
            },
        },
        icons: {
            16: '/icons/icon-16.png',
            32: '/icons/icon-32.png',
            48: '/icons/icon-48.png',
            128: '/icons/icon-128.png',
        },
    },
    srcDir: '.',
    publicDir: 'public',
    vite: () => ({
        plugins: [tailwindcss()],
    }),
});
