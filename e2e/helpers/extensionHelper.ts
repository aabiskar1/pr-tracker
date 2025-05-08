import path from 'path';
import fs from 'fs';
import { getBrowserName } from './utils.js';

/**
 * Get the path to the extension directory based on browser type
 */
export function getExtensionPath(): string {
    const browserName = getBrowserName();

    // Determine extension directory based on browser
    const extensionDir =
        browserName === 'firefox'
            ? path.resolve(process.cwd(), 'dist-firefox')
            : path.resolve(process.cwd(), 'dist-chrome');

    // Verify the extension directory exists
    if (!fs.existsSync(extensionDir)) {
        throw new Error(
            `Extension directory not found at ${extensionDir}. Make sure to build the extension first.`
        );
    }

    return extensionDir;
}

/**
 * Get extension ID for directly accessing extension pages in tests
 * For development testing, this retrieves IDs at runtime from the browser
 */
export async function getExtensionId(browser: any): Promise<string> {
    // Check if we have the getExtensionId command available (added in wdio.conf.ts)
    if (typeof browser.getExtensionId === 'function') {
        return await browser.getExtensionId();
    }

    const browserName = getBrowserName();

    if (browserName === 'chrome') {
        // Open Chrome's extension page
        await browser.url('chrome://extensions');

        // Enable developer mode to see extension IDs
        await browser.execute(() => {
            const devModeToggle = document
                .querySelector('extensions-manager')
                ?.shadowRoot?.querySelector('#devMode');
            if (devModeToggle) {
                (devModeToggle as HTMLElement).click();
            }
        });

        await browser.pause(500);

        // Execute script to find the extension ID
        const extensionId = await browser.execute(() => {
            const extensionsManager =
                document.querySelector('extensions-manager');
            const itemList = extensionsManager?.shadowRoot?.querySelector(
                'extensions-item-list'
            );
            const items =
                itemList?.shadowRoot?.querySelectorAll('extensions-item');

            for (const item of items || []) {
                const name =
                    item.shadowRoot?.querySelector('#name')?.textContent;
                if (name && name.includes('PR Tracker')) {
                    // Extract ID from the extensions-item element
                    return item.id || '';
                }
            }
            return '';
        });

        return extensionId;
    } else if (browserName === 'firefox') {
        // For Firefox, we can use the fixed ID from manifest or get it at runtime
        // First try using the fixed ID that Firefox uses
        const fixedId = '{dabd690e-283a-4c0a-98de-3fc963365d13}';

        // If we want to get it dynamically, we can use about:debugging
        if (process.env.DYNAMIC_EXTENSION_ID) {
            // Open Firefox's about:debugging page
            await browser.url('about:debugging#/runtime/this-firefox');

            // Wait for the page to load and extensions to be listed
            await browser.pause(1000);

            // Execute script to find the extension ID
            const extensionId = await browser.execute(() => {
                const extensionItems = document.querySelectorAll(
                    '.addon-target-container'
                );
                for (const item of extensionItems) {
                    const name = item.querySelector('.addon-name')?.textContent;
                    if (name && name.includes('PR Tracker')) {
                        // Find the internal UUID
                        const internalId = item.querySelector(
                            '.addon-target-info-internal-id'
                        )?.textContent;
                        return internalId || '';
                    }
                }
                return '';
            });

            return extensionId || fixedId;
        }

        return fixedId;
    }

    throw new Error(`Unsupported browser: ${browserName}`);
}
