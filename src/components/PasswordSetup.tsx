import React, { useState } from 'react';
import {
    FaLock,
    FaShieldAlt,
    FaQuestionCircle,
    FaClock,
    FaKey,
} from 'react-icons/fa';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface PasswordSetupProps {
    password: string;
    setPassword: (password: string) => void;
    confirmPassword: string;
    setConfirmPassword: (password: string) => void;
    rememberPassword: boolean;
    setRememberPassword: (remember: boolean) => void;
    handlePasswordSetup: (e: React.FormEvent) => void;
    passwordError: string;
    onBack: () => void;
}

export const PasswordSetup: React.FC<PasswordSetupProps> = ({
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    rememberPassword,
    setRememberPassword,
    handlePasswordSetup,
    passwordError,
    onBack,
}) => {
    const [showPasswordHelp, setShowPasswordHelp] = useState(false);

    return (
        <div className="screen-auth mx-auto w-full max-w-md rounded-xl bg-background p-6 text-foreground shadow-md">
            <div className="flex items-center justify-center mb-6">
                <FaLock className="mr-2 text-4xl text-muted-foreground" />
                <h2 className="text-2xl font-bold text-foreground">
                    Create a Password
                </h2>
            </div>

            <p className="mb-4 text-muted-foreground">
                Create a password to encrypt your stored GitHub token and unlock
                it later. You won't need to re-enter it while PR Tracker remains
                unlocked.
            </p>

            <div className="mb-4 flex items-start rounded-md bg-accent p-3 text-accent-foreground">
                <div className="flex-shrink-0 mt-1">
                    <FaShieldAlt />
                </div>
                <div className="ml-3">
                    <p className="text-sm">
                        Your password stays in memory while unlocked. If you
                        choose “Remember password for 12 hours,” it is also
                        stored in browser extension session storage for that
                        remembered session.
                    </p>
                </div>
            </div>

            <form
                onSubmit={handlePasswordSetup}
                className="space-y-4"
                autoComplete="on"
                name="password-setup-form"
            >
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label
                            htmlFor="newPassword"
                            className="text-sm font-medium text-muted-foreground"
                        >
                            Password
                        </label>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto px-0 text-xs text-primary"
                            onClick={() =>
                                setShowPasswordHelp(!showPasswordHelp)
                            }
                            aria-label="Password requirements"
                        >
                            <FaQuestionCircle className="mr-1" />
                            Requirements
                        </Button>
                    </div>

                    {showPasswordHelp && (
                        <div
                            className="mb-2 rounded bg-muted p-2 text-xs text-muted-foreground"
                            id="password-help"
                        >
                            <ul className="list-disc pl-4 space-y-1">
                                <li>At least 8 characters long</li>
                                <li>
                                    Remember this password - there's no recovery
                                    option!
                                </li>
                            </ul>
                        </div>
                    )}

                    <Input
                        id="newPassword"
                        name="new-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="px-4"
                        aria-label="Password"
                        placeholder="Enter password"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        data-1p-ignore="false"
                        data-lpignore="false"
                        data-bwignore="false"
                        data-form-type="password"
                        {...(passwordError ? { 'aria-invalid': 'true' } : {})}
                        aria-describedby={
                            `${showPasswordHelp ? 'password-help' : ''}${showPasswordHelp && passwordError ? ' ' : ''}${passwordError ? 'password-error' : ''}` ||
                            undefined
                        }
                        minLength={8}
                        required
                    />
                </div>

                <div>
                    <label
                        htmlFor="confirmNewPassword"
                        className="mb-1 block text-sm font-medium text-muted-foreground"
                    >
                        Confirm Password
                    </label>
                    <Input
                        id="confirmNewPassword"
                        name="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="px-4"
                        aria-label="Confirm Password"
                        placeholder="Confirm password"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        data-1p-ignore="false"
                        data-lpignore="false"
                        data-bwignore="false"
                        data-form-type="password"
                        {...(passwordError ? { 'aria-invalid': 'true' } : {})}
                        aria-describedby={
                            `${showPasswordHelp ? 'password-help' : ''}${showPasswordHelp && passwordError ? ' ' : ''}${passwordError ? 'password-error' : ''}` ||
                            undefined
                        }
                        required
                    />
                </div>

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

                <Button
                    type="submit"
                    className="w-full"
                    aria-label="Create Password"
                >
                    <FaKey className="mr-2" />
                    Create Password & Encrypt Token
                </Button>
            </form>

            {passwordError && (
                <div
                    className="mt-4 flex items-center error-message text-sm rounded px-4 py-3"
                    role="alert"
                    id="password-error"
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
                    <span>{passwordError}</span>
                </div>
            )}

            <Button
                onClick={onBack}
                variant="secondary"
                className="mt-4 w-full"
                aria-label="Go Back"
            >
                Go Back
            </Button>
        </div>
    );
};
