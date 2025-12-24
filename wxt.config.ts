import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    modules: ['@wxt-dev/module-react'],
    manifest: {
        name: 'PR Tracker',
        description: 'Track and manage your GitHub pull requests',
        version: '1.0.11',
        permissions: ['storage', 'notifications', 'alarms'],
        host_permissions: ['https://api.github.com/*'],
        browser_specific_settings: {
            gecko: {
                id: '{dabd690e-283a-4c0a-98de-3fc963365d13}',
            },
        },
    },
    srcDir: '.',
    publicDir: 'public',
    vite: () => ({
        plugins: [tailwindcss()],
    }),
});
