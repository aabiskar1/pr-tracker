import { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';
import {
    encryptToken,
    validatePassword as validatePasswordService,
    hasStoredToken,
    hasEncryptionSetup,
    clearSecureStorage,
} from '../services/secureStorage';

export type AuthState =
    | 'initializing'
    | 'login-needed'
    | 'password-setup'
    | 'password-entry'
    | 'authenticated';

export function useAuth() {
    const [token, setToken] = useState<string>('');
    const [password, setPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [rememberPassword, setRememberPassword] = useState<boolean>(false);
    const [authState, setAuthState] = useState<AuthState>('initializing');
    const [isLoading, setIsLoading] = useState(true);
    const [tokenError, setTokenError] = useState<string>('');
    const [passwordError, setPasswordError] = useState<string>('');

    useEffect(() => {
        const initializeApp = async () => {
            try {
                // First check if we have a remembered password
                const rememberedPasswordResponse =
                    (await browser.runtime.sendMessage({
                        type: 'GET_REMEMBERED_PASSWORD',
                    })) as {
                        hasRememberedPassword: boolean;
                        password?: string;
                    };

                if (
                    rememberedPasswordResponse &&
                    rememberedPasswordResponse.hasRememberedPassword &&
                    rememberedPasswordResponse.password
                ) {
                    console.log('Found remembered password, auto-signing in');
                    setPassword(rememberedPasswordResponse.password);
                    setAuthState('authenticated');

                    // Trigger a throttled background refresh
                    console.log('Triggering background PR refresh...');
                    await browser.runtime.sendMessage({
                        type: 'CHECK_PRS',
                        password: rememberedPasswordResponse.password,
                    });

                    setIsLoading(false);
                    return;
                }

                const isEncryptionSetup = await hasEncryptionSetup();
                const hasToken = await hasStoredToken();

                if (!hasToken) {
                    setAuthState('login-needed');
                } else if (!isEncryptionSetup) {
                    setAuthState('password-setup');
                } else {
                    setAuthState('password-entry');
                }

                setIsLoading(false);
            } catch (error) {
                console.error('Error initializing app:', error);
                setIsLoading(false);
            }
        };

        initializeApp();
    }, []);

    const validateToken = async (tokenToCheck: string) => {
        try {
            const response = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `token ${tokenToCheck}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });

            if (!response.ok) {
                throw new Error('Invalid token');
            }

            const scopes =
                response.headers
                    .get('x-oauth-scopes')
                    ?.split(',')
                    .map((s) => s.trim()) || [];
            if (!scopes.includes('repo')) {
                throw new Error(
                    'Token needs "repo" scope. Please generate a new token with repo access.'
                );
            }

            return true;
        } catch (error) {
            if (error instanceof Error) {
                setTokenError(error.message);
            } else {
                setTokenError('Failed to validate token');
            }
            return false;
        }
    };

    const handleTokenSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setTokenError('');

        const isValid = await validateToken(token);
        if (isValid) {
            console.log('Token valid, moving to password setup');
            setAuthState('password-setup');
            setIsLoading(false);
        } else {
            setIsLoading(false);
        }
    };

    const handlePasswordSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError('');

        if (password.length < 8) {
            setPasswordError('Password must be at least 8 characters long');
            return;
        }

        if (password !== confirmPassword) {
            setPasswordError('Passwords do not match');
            return;
        }

        setIsLoading(true);
        try {
            await encryptToken(token, password);

            await browser.runtime.sendMessage({
                type: 'SET_PASSWORD',
                password,
                remember: rememberPassword,
            });

            setAuthState('authenticated');

            await browser.runtime.sendMessage({
                type: 'CHECK_PRS',
                password,
            });

            setIsLoading(false);
        } catch (error) {
            console.error('Error setting up password:', error);
            setPasswordError('Error setting up encryption. Please try again.');
            setIsLoading(false);
        }
    };

    const handlePasswordEntry = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError('');

        if (!password) {
            setPasswordError('Please enter your password');
            return;
        }

        setIsLoading(true);
        try {
            const isValid = await validatePasswordService(password);
            if (!isValid) {
                setPasswordError('Incorrect password');
                setIsLoading(false);
                return;
            }

            await browser.runtime.sendMessage({
                type: 'SET_PASSWORD',
                password,
                remember: rememberPassword,
            });

            setAuthState('authenticated');

            await browser.runtime.sendMessage({
                type: 'CHECK_PRS',
                password,
            });

            setIsLoading(false);
        } catch (error) {
            console.error('Error validating password:', error);
            setPasswordError('Error validating password. Please try again.');
            setIsLoading(false);
        }
    };

    const handleSignOut = async () => {
        setIsLoading(true);
        try {
            await browser.runtime.sendMessage({ type: 'CLEAR_SESSION' });

            setToken('');
            setPassword('');
            setConfirmPassword('');
            setAuthState('password-entry');
        } catch (error) {
            console.error('Error signing out:', error);
        }
        setIsLoading(false);
    };

    const handleReset = async () => {
        if (
            confirm(
                'This will remove all stored data including your GitHub token. You will need to set up the extension again. Continue?'
            )
        ) {
            setIsLoading(true);
            try {
                await clearSecureStorage();
                await browser.runtime.sendMessage({ type: 'CLEAR_SESSION' });

                setToken('');
                setPassword('');
                setConfirmPassword('');
                setAuthState('login-needed');
            } catch (error) {
                console.error('Error resetting app:', error);
            }
            setIsLoading(false);
        }
    };

    return {
        token,
        setToken,
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        rememberPassword,
        setRememberPassword,
        authState,
        isLoading,
        tokenError,
        passwordError,
        handleTokenSubmit,
        handlePasswordSetup,
        handlePasswordEntry,
        handleSignOut,
        handleReset,
    };
}
