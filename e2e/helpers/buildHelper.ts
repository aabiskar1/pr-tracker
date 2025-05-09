import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Build extension for Chrome
 */
export function buildExtension(browserName: string): void {
    console.log('Building extension for Chrome...');

    try {
        execSync('npm run build:chrome', { stdio: 'inherit' });

        // Verify build was successful
        const distDir = path.resolve(process.cwd(), 'dist-chrome');
        if (!fs.existsSync(distDir)) {
            throw new Error(`Build failed: ${distDir} directory not found`);
        }

        console.log('Extension built successfully');
    } catch (error) {
        console.error('Failed to build extension:', error);
        throw error;
    }
}
