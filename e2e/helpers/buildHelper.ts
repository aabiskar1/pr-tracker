import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Build extension for the specified browser
 * @param browserName 'chrome' or 'firefox'
 */
export function buildExtension(browserName: string): void {
    console.log(`Building extension for ${browserName}...`);

    try {
        // Execute the appropriate build command
        if (browserName.toLowerCase() === 'firefox') {
            execSync('npm run build:firefox', { stdio: 'inherit' });
        } else {
            // Default to Chrome
            execSync('npm run build:chrome', { stdio: 'inherit' });
        }

        // Verify build was successful
        const distDir = path.resolve(
            process.cwd(),
            `dist-${browserName.toLowerCase()}`
        );
        if (!fs.existsSync(distDir)) {
            throw new Error(`Build failed: ${distDir} directory not found`);
        }

        console.log(`Extension built successfully for ${browserName}`);
    } catch (error) {
        console.error(`Failed to build extension for ${browserName}:`, error);
        throw error;
    }
}
