import path from 'path';
import fs from 'fs';

/**
 * Get the path to the extension directory for Chrome
 */
export function getExtensionPath(): string {
    const extensionDir = path.resolve(process.cwd(), 'dist-chrome');

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
        const extensionsManager = document.querySelector('extensions-manager');
        const itemList = extensionsManager?.shadowRoot?.querySelector(
            'extensions-item-list'
        );
        const items = itemList?.shadowRoot?.querySelectorAll('extensions-item');

        for (const item of items || []) {
            const name = item.shadowRoot?.querySelector('#name')?.textContent;
            if (name && name.includes('PR Tracker')) {
                // Extract ID from the extensions-item element
                return item.id || '';
            }
        }
        return '';
    });

    return extensionId;
}
