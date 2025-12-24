import React from 'react';
import { FaGithub } from 'react-icons/fa';

interface LoginProps {
    token: string;
    setToken: (token: string) => void;
    handleTokenSubmit: (e: React.FormEvent) => void;
    tokenError: string;
}

export const Login: React.FC<LoginProps> = ({
    token,
    setToken,
    handleTokenSubmit,
    tokenError,
}) => {
    return (
        <div className="screen-auth w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md">
            <div className="flex items-center justify-center mb-6">
                <FaGithub className="text-4xl text-gray-700 dark:text-gray-300 mr-2" />
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                    GitHub Authentication
                </h2>
            </div>

            <p className="text-gray-600 dark:text-gray-300 mb-4">
                Please enter your GitHub personal access token. Your token will
                be securely encrypted before storage.
            </p>

            <form
                onSubmit={handleTokenSubmit}
                className="space-y-4"
                autoComplete="on"
                name="github-token-form"
            >
                <input
                    id="githubToken"
                    name="github-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_..."
                    className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    aria-label="GitHub personal access token"
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore="false"
                    data-lpignore="false"
                    data-bwignore="false"
                    data-form-type="password"
                    aria-describedby={tokenError ? 'token-error' : undefined}
                    {...(tokenError ? { 'aria-invalid': 'true' } : {})}
                />
                <button
                    type="submit"
                    className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors"
                    aria-label="Save Token"
                >
                    Next
                </button>
            </form>

            {tokenError && (
                <div
                    className="mt-4 flex items-center error-message text-sm rounded px-4 py-3"
                    role="alert"
                    id="token-error"
                    aria-live="assertive"
                >
                    <svg
                        className="w-5 h-5 mr-2 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path
                            fillRule="evenodd"
                            d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 112 0v4a1 1 0 01-2 0V6zm1 8a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
                            clipRule="evenodd"
                        />
                    </svg>
                    <span>{tokenError}</span>
                </div>
            )}

            <div className="mt-6 text-center">
                <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=PR%20Tracker"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-primary hover:underline"
                    aria-label="Generate a new token with repo access"
                >
                    <FaGithub className="mr-1" />
                    Generate a new token with repo access
                </a>
            </div>
        </div>
    );
};
