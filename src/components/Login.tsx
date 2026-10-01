import React from 'react';
import { FaGithub } from 'react-icons/fa';
import { Button } from './ui/button';
import { Input } from './ui/input';

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
        <div className="screen-auth mx-auto w-full max-w-md rounded-xl bg-background p-6 text-foreground shadow-md">
            <div className="flex items-center justify-center mb-6">
                <FaGithub className="mr-2 text-4xl text-muted-foreground" />
                <h2 className="text-2xl font-bold text-foreground">
                    GitHub Authentication
                </h2>
            </div>

            <p className="mb-4 text-muted-foreground">
                Please enter your GitHub personal access token. Your token will
                be securely encrypted before storage.
            </p>

            <form
                onSubmit={handleTokenSubmit}
                className="space-y-4"
                autoComplete="on"
                name="github-token-form"
            >
                <Input
                    id="githubToken"
                    name="github-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_..."
                    className="px-4"
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
                <Button
                    type="submit"
                    className="w-full"
                    aria-label="Save Token"
                >
                    Next
                </Button>
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
