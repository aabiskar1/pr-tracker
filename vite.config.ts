import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import webExtension from '@samrum/vite-plugin-web-extension'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isFirefox = process.env.BROWSER === 'firefox'

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: {
        manifest_version: isFirefox ? 2 : 3,
        name: "PR Tracker",
        version: "1.0.0",
        description: "Track and manage your GitHub pull requests",
        permissions: [
          "storage",
          "notifications",
          "alarms",
          ...(isFirefox ? ["https://api.github.com/*"] : [])
        ],
        ...(isFirefox ? {
          browser_specific_settings: {
            gecko: {
              id: "prtracker@example.com"
            }
          },
          background: {
            scripts: ['src/background/index.ts'],
            persistent: false
          },
          browser_action: {
            default_popup: "index.html",
            default_icon: "icon.svg",
            browser_style: true
          },
          content_security_policy: "script-src 'self'; object-src 'self';"
        } : {
          host_permissions: [
            "https://api.github.com/*"
          ],
          background: {
            service_worker: 'src/background/index.ts',
            type: 'module'
          },
          action: {
            default_popup: "index.html",
            default_icon: "icon.svg"
          }
        }),
        icons: {
          "128": "icon.svg"
        }
      }
    } as any)
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: process.env.BROWSER ? `dist-${process.env.BROWSER}` : 'dist',
    emptyOutDir: true
  }
})