import puppeteer, { Browser, Page } from 'puppeteer';
import { beforeAll, afterAll } from 'vitest';
import { puppeteerConfig } from '../puppeteer.config.mjs';
import fs from 'fs';
import path from 'path';

// Module-level variables
let browser: Browser;
let extensionId: string;

beforeAll(async () => {
    console.log(
        'Launching browser with extension path:',
        puppeteerConfig.extensionPath
    );

    // Verify extension exists before launching
    const manifestPath = path.join(
        puppeteerConfig.extensionPath,
        'manifest.json'
    );
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Extension manifest not found at: ${manifestPath}`);
    }

    browser = await puppeteer.launch(puppeteerConfig.launch);

    // Wait for extension to load
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Get extension ID
    extensionId = await getExtensionIdFromBrowser();
    console.log('Extension ID found:', extensionId);
}, 30000);

afterAll(async () => {
    if (browser) {
        await browser.close();
    }
});

export const getBrowser = (): Browser => browser;
export const getExtensionId = (): string => extensionId;

const getExtensionIdFromBrowser = async (): Promise<string> => {
    // Method 1: Try to find extension via browser targets
    const targets = await browser.targets();
    console.log(
        'Available targets:',
        targets.map((t) => ({ type: t.type(), url: t.url() }))
    );

    // Look for extension service worker or background page
    const extensionTarget = targets.find((target) => {
        const url = target.url();
        return (
            url.startsWith('chrome-extension://') &&
            (url.includes('background') ||
                url.includes('service_worker') ||
                target.type() === 'service_worker')
        );
    });

    if (extensionTarget) {
        const url = extensionTarget.url();
        const match = url.match(/chrome-extension:\/\/([a-z]{32})/);
        if (match) {
            return match[1];
        }
    }

    // Method 2: Check chrome://extensions page
    const extensionsPage = await browser.newPage();
    try {
        await extensionsPage.goto('chrome://extensions/');

        // Enable developer mode
        await extensionsPage.evaluate(() => {
            const manager = document.querySelector('extensions-manager');
            if (manager && manager.shadowRoot) {
                const devModeToggle = manager.shadowRoot.querySelector(
                    '#devMode'
                ) as HTMLInputElement;
                if (devModeToggle && !devModeToggle.checked) {
                    devModeToggle.click();
                }
            }
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const id = await extensionsPage.evaluate(() => {
            const manager = document.querySelector('extensions-manager');
            if (!manager?.shadowRoot) return null;

            const itemList = manager.shadowRoot.querySelector(
                'extensions-item-list'
            );
            if (!itemList?.shadowRoot) return null;

            const items =
                itemList.shadowRoot.querySelectorAll('extensions-item');

            for (const item of items) {
                if (item.shadowRoot) {
                    const nameElement = item.shadowRoot.querySelector('#name');
                    const name = nameElement?.textContent?.trim();
                    console.log('Found extension:', name);

                    if (name?.includes('PR Tracker')) {
                        return item.getAttribute('id');
                    }
                }
            }
            return null;
        });

        return id || '';
    } finally {
        await extensionsPage.close();
    }
};

export const openExtensionPopup = async (id?: string): Promise<Page> => {
    const extensionIdToUse = id || extensionId;
    const popupPage = await browser.newPage();

    await popupPage.goto(`chrome-extension://${extensionIdToUse}/index.html`, {
        waitUntil: 'domcontentloaded',
    });

    // Wait for content to load
    await popupPage.waitForSelector('body', { timeout: 5000 });

    return popupPage;
};

export const waitForElement = async (
    page: Page,
    selector: string,
    timeout = 5000
) => {
    return await page.waitForSelector(selector, { timeout });
};

export const getExtensionInfo = async () => {
    const manifestPath = path.join(
        puppeteerConfig.extensionPath,
        'manifest.json'
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    return {
        id: extensionId,
        name: manifest.name,
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
    };
};

// Helper to debug extension loading
export const debugExtensionTargets = async () => {
    const targets = await browser.targets();
    console.log('\n=== All Browser Targets ===');
    targets.forEach((target, index) => {
        console.log(`${index}: Type: ${target.type()}, URL: ${target.url()}`);
    });

    const extensionTargets = targets.filter((t) =>
        t.url().startsWith('chrome-extension://')
    );
    console.log('\n=== Extension Targets ===');
    extensionTargets.forEach((target, index) => {
        console.log(`${index}: ${target.type()} - ${target.url()}`);
    });

    return extensionTargets;
};
