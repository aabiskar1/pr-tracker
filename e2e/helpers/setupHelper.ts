import { buildExtension } from './buildHelper';
import { getBrowserName } from './utils';

/**
 * Setup function to be called before running extension tests
 */
export async function setupExtensionTest(): Promise<void> {
    const browserName = getBrowserName();

    // Build extension for the current browser
    buildExtension(browserName);

    // Return without error if setup completed successfully
    return Promise.resolve();
}
