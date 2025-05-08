/**
 * Get the current browser name from environment variable or configuration
 */
export function getBrowserName(): string {
    // Check environment variable first
    if (process.env.BROWSER) {
        return process.env.BROWSER.toLowerCase();
    }

    // Default to chrome if not specified
    return 'chrome';
}
