import fs from 'fs';
import path from 'path';
import { getBrowserName } from './utils';

/**
 * Load extension for Chrome browser testing by creating a base64 encoded string
 * from the extension directory.
 */
export function getChromeExtensionBase64(): string {
    // This function will be used to properly load the Chrome extension
    const extensionPath = path.resolve(process.cwd(), 'dist-chrome');

    // Read manifest.json
    const manifestPath = path.join(extensionPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            `Manifest not found at ${manifestPath}. Make sure to build the extension first.`
        );
    }

    // Create a zip buffer of the extension directory
    // For now, we'll just return the path to use with --load-extension option
    return extensionPath;
}

/**
 * Get arguments for loading the extension in Chrome
 */
export function getExtensionArgs(): string[] {
    const isDebug = Boolean(process.env.DEBUG);
    const baseArgs = [];

    // Add headless mode if not in debug
    if (!isDebug) {
        baseArgs.push('--headless');
    }

    // Add load extension argument for Chrome
    const extensionPath = getChromeExtensionBase64();
    baseArgs.push(`--load-extension=${extensionPath}`);

    return baseArgs;
}
