import React from 'react';
import { FaUnlock, FaSignInAlt, FaClock } from 'react-icons/fa';
import { FullResetControl } from './FullResetControl';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface PasswordEntryProps {
    password: string;
    setPassword: (password: string) => void;
    rememberPassword: boolean;
    setRememberPassword: (remember: boolean) => void;
    handlePasswordEntry: (e: React.FormEvent) => void;
    passwordError: string;
    handleReset: () => Promise<boolean>;
}

export const PasswordEntry: React.FC<PasswordEntryProps> = ({
    password,
    setPassword,
    rememberPassword,
    setRememberPassword,
    handlePasswordEntry,
    passwordError,
    handleReset,
}) => {
    return (
        <div className="screen-auth mx-auto w-full max-w-md rounded-xl bg-background p-6 text-foreground shadow-md">
            <div className="flex items-center justify-center mb-6">
                <FaUnlock className="mr-2 text-4xl text-muted-foreground" />
                <h2 className="text-2xl font-bold text-foreground">
                    Enter Password
                </h2>
            </div>

            <p className="mb-4 text-muted-foreground">
                Enter your password to decrypt your GitHub token and access your
                pull requests.
            </p>

            <form
                onSubmit={handlePasswordEntry}
                className="space-y-4"
                autoComplete="on"
                name="password-entry-form"
            >
                <Input
                    id="currentPassword"
                    name="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="px-4"
                    aria-label="Enter your password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore="false"
                    data-lpignore="false"
                    data-bwignore="false"
                    data-form-type="password"
                    aria-describedby={
                        passwordError ? 'password-error' : undefined
                    }
                    {...(passwordError ? { 'aria-invalid': 'true' } : {})}
                    required
                />

                <div className="flex items-center">
                    <input
                        id="rememberPassword"
                        type="checkbox"
                        checked={rememberPassword}
                        onChange={(e) => setRememberPassword(e.target.checked)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                    />
                    <label
                        htmlFor="rememberPassword"
                        className="ml-2 flex items-center text-sm text-muted-foreground"
                    >
                        <FaClock className="mr-1 text-muted-foreground" />
                        Remember password for 12 hours
                    </label>
                </div>

                <Button type="submit" className="w-full" aria-label="Sign In">
                    <FaSignInAlt className="mr-2" />
                    Sign In
                </Button>
            </form>

            {passwordError && (
                <div
                    className="mt-4 flex items-center error-message text-sm rounded px-4 py-3"
                    role="alert"
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
                    <span>{passwordError}</span>
                </div>
            )}

            <FullResetControl onConfirm={handleReset} />
        </div>
    );
};
