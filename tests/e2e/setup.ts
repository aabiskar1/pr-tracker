import puppeteer, { type Browser, type Page } from 'puppeteer';
import { afterAll, beforeAll } from 'vitest';
import { puppeteerConfig } from '../../puppeteer.config.mjs';
import fs from 'fs';
import path from 'path';

let browser: Browser;
let extensionId: string;

beforeAll(async () => {
    console.log(
        'Launching browser with extension path:',
        puppeteerConfig.extensionPath
    );

    const manifestPath = path.join(
        puppeteerConfig.extensionPath,
        'manifest.json'
    );
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Extension manifest not found at: ${manifestPath}`);
    }

    browser = await puppeteer.launch(puppeteerConfig.launch);

    await browser.waitForTarget(
        (target) =>
            target.type() === 'service_worker' &&
            target.url().startsWith('chrome-extension://'),
        { timeout: 10000 }
    );

    extensionId = await getExtensionIdFromBrowser();
    console.log('Extension ID found:', extensionId);
}, 30000);

afterAll(async () => {
    if (browser) {
        await browser.close();
        console.log('Browser closed:', extensionId);
    }
});

export const getBrowser = (): Browser => browser;
export const getExtensionId = (): string => extensionId;

const getExtensionIdFromBrowser = async (): Promise<string> => {
    const targets = await browser.targets();
    console.log(
        'Available targets:',
        targets.map((target) => ({ type: target.type(), url: target.url() }))
    );

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
        const match = extensionTarget
            .url()
            .match(/chrome-extension:\/\/([a-z]{32})/);
        if (match) return match[1];
    }

    const extensionsPage = await browser.newPage();
    try {
        await extensionsPage.goto('chrome://extensions/');
        await extensionsPage.evaluate(() => {
            const manager = document.querySelector('extensions-manager');
            const devModeToggle = manager?.shadowRoot?.querySelector(
                '#devMode'
            ) as HTMLInputElement | null;
            if (devModeToggle && !devModeToggle.checked) devModeToggle.click();
        });
        await extensionsPage.waitForFunction(() => {
            const manager = document.querySelector('extensions-manager');
            return Boolean(
                manager?.shadowRoot?.querySelector('extensions-item-list')
            );
        });

        return (
            (await extensionsPage.evaluate(() => {
                const manager = document.querySelector('extensions-manager');
                const itemList = manager?.shadowRoot?.querySelector(
                    'extensions-item-list'
                );
                const items =
                    itemList?.shadowRoot?.querySelectorAll('extensions-item') ??
                    [];
                for (const item of items) {
                    const name = item.shadowRoot
                        ?.querySelector('#name')
                        ?.textContent?.trim();
                    if (name?.includes('PR Tracker')) {
                        return item.getAttribute('id');
                    }
                }
                return null;
            })) ?? ''
        );
    } finally {
        await extensionsPage.close();
    }
};

export const openExtensionPopup = async (id?: string): Promise<Page> => {
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${id || extensionId}/popup.html`, {
        waitUntil: 'domcontentloaded',
    });
    await popupPage.waitForSelector('body', { timeout: 5000 });
    return popupPage;
};

export const waitForElement = async (
    page: Page,
    selector: string,
    timeout = 5000
) => page.waitForSelector(selector, { timeout });

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

export const debugExtensionTargets = async () => {
    const targets = await browser.targets();
    console.log('\n=== All Browser Targets ===');
    targets.forEach((target, index) => {
        console.log(`${index}: Type: ${target.type()}, URL: ${target.url()}`);
    });
    const extensionTargets = targets.filter((target) =>
        target.url().startsWith('chrome-extension://')
    );
    console.log('\n=== Extension Targets ===');
    extensionTargets.forEach((target, index) => {
        console.log(`${index}: ${target.type()} - ${target.url()}`);
    });
    return extensionTargets;
};
