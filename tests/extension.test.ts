// tests/extension.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Page } from 'puppeteer';
import {
    getBrowser,
    getExtensionId,
    openExtensionPopup,
    getExtensionInfo,
    waitForElement,
    debugExtensionTargets,
} from './setup.js';

describe('PR Tracker Extension', () => {
    let popupPage: Page;

    test('debug extension loading', async () => {
        const targets = await debugExtensionTargets();
        const extensionId = getExtensionId();
        const info = await getExtensionInfo();

        console.log('Extension ID:', extensionId);
        console.log('Extension Info:', info);
        console.log('Extension targets found:', targets.length);

        expect(extensionId).toBeDefined();
        expect(extensionId.length).toBeGreaterThan(0);
    });

    beforeEach(async () => {
        popupPage = await openExtensionPopup();
    });

    afterEach(async () => {
        if (popupPage && !popupPage.isClosed()) {
            await popupPage.close();
        }
    });

    test('popup loads successfully', async () => {
        await waitForElement(popupPage, 'body');

        const title = await popupPage.title();
        expect(title).toBeTruthy();
    });
});
