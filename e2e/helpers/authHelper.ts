import dotenv from 'dotenv';
import path from 'path';
import { browser } from '@wdio/globals';

// Load environment variables from .env.test file
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

/**
 * Helper functions for authentication in tests
 */

/**
 * Get the GitHub token from environment variables
 */
export function getGitHubToken(): string {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error(
            'GITHUB_TOKEN not found in .env.test file. Please add it to run the tests.'
        );
    }
    return token;
}

/**
 * Check if the user is already authenticated in the extension
 */
export async function isAuthenticated(): Promise<boolean> {
    try {
        // Check for either PR list or settings button, which would indicate authenticated state
        const prList = await browser.$('.pr-list, div.space-y-3');
        const settingsButton = await browser.$(
            'button[aria-label="Settings"], button[title="Settings"]'
        );

        return (
            (await prList.isExisting()) || (await settingsButton.isExisting())
        );
    } catch (error) {
        return false;
    }
}

/**
 * Fill in the authentication form with the GitHub token
 */
export async function fillAuthForm(
    token: string = getGitHubToken()
): Promise<void> {
    // Look for the token input field
    const tokenInput = await browser.$(
        'input[type="password"], input[placeholder*="token"]'
    );
    await tokenInput.waitForExist({ timeout: 5000 });

    // Clear any existing token and fill with our test token
    await tokenInput.clearValue();
    await tokenInput.setValue(token);

    // Submit the form
    const submitButton = await browser.$(
        'button[type="submit"], button*=Authenticate'
    );
    await submitButton.click();

    // Wait for the authentication process
    await browser.pause(2000);
}

/**
 * Set up a password for token encryption
 * @param password The password to use (defaults to 'TestPassword123!')
 */
export async function setupTokenPassword(
    password: string = 'TestPassword123!'
): Promise<void> {
    // Look for password input fields
    const passwordInput = await browser.$(
        'input[type="password"][id="password"], input[placeholder*="password"]'
    );
    const confirmPasswordInput = await browser.$(
        'input[type="password"][id="confirmPassword"], input[placeholder*="confirm"]'
    );

    await passwordInput.waitForExist({ timeout: 5000 });

    // Fill in the password fields
    await passwordInput.clearValue();
    await passwordInput.setValue(password);

    await confirmPasswordInput.clearValue();
    await confirmPasswordInput.setValue(password);

    // Check the "Remember password" checkbox if it exists
    try {
        const rememberCheckbox = await browser.$(
            'input[type="checkbox"], input#rememberPassword'
        );
        if (await rememberCheckbox.isExisting()) {
            await rememberCheckbox.click();
        }
    } catch (error) {
        // Checkbox might not exist, continue
    }

    // Submit the form
    const submitButton = await browser.$(
        'button[type="submit"], button*=Set Password'
    );
    await submitButton.click();

    // Wait for the setup to complete
    await browser.pause(2000);
}

/**
 * Enter existing password for decryption
 * @param password The password to use (defaults to 'TestPassword123!')
 */
export async function enterPassword(
    password: string = 'TestPassword123!'
): Promise<void> {
    // Look for password input field
    const passwordInput = await browser.$(
        'input[type="password"], input[placeholder*="password"]'
    );
    await passwordInput.waitForExist({ timeout: 5000 });

    // Fill in the password
    await passwordInput.clearValue();
    await passwordInput.setValue(password);

    // Check the "Remember password" checkbox if it exists
    try {
        const rememberCheckbox = await browser.$(
            'input[type="checkbox"], input#rememberPassword'
        );
        if (
            (await rememberCheckbox.isExisting()) &&
            !(await rememberCheckbox.isSelected())
        ) {
            await rememberCheckbox.click();
        }
    } catch (error) {
        // Checkbox might not exist, continue
    }

    // Submit the form
    const submitButton = await browser.$(
        'button[type="submit"], button*=Unlock'
    );
    await submitButton.click();

    // Wait for the unlock process to complete
    await browser.pause(2000);
}

/**
 * Authenticate the extension by handling all authentication steps
 * (token entry, password setup, or password entry)
 */
export async function authenticateExtension(): Promise<void> {
    // Wait for the initial UI to load
    await browser.pause(1000);

    // Determine which authentication step we're at
    const tokenInput = await browser.$(
        'input[placeholder*="token"], input[placeholder*="GitHub"]'
    );
    const passwordInput = await browser.$(
        'input[id="password"], input[placeholder*="password"]'
    );
    const confirmPasswordInput = await browser.$(
        'input[id="confirmPassword"], input[placeholder*="confirm"]'
    );

    if (await tokenInput.isExisting()) {
        // We're at the token input step
        await fillAuthForm();

        // After token submission, we should reach the password setup step
        await browser.pause(1000);
        await setupTokenPassword();
    } else if (
        (await passwordInput.isExisting()) &&
        (await confirmPasswordInput.isExisting())
    ) {
        // We're at the password setup step
        await setupTokenPassword();
    } else if (await passwordInput.isExisting()) {
        // We're at the password entry step
        await enterPassword();
    }

    // Wait for the authentication process to finish
    await browser.pause(3000);
}
