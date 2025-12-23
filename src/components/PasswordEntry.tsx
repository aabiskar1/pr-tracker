import React from 'react';
import { FaUnlock, FaSignInAlt, FaClock } from 'react-icons/fa';

interface PasswordEntryProps {
    password: string;
    setPassword: (password: string) => void;
    rememberPassword: boolean;
    setRememberPassword: (remember: boolean) => void;
    handlePasswordEntry: (e: React.FormEvent) => void;
    passwordError: string;
    handleReset: () => void;
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
        <div className="screen-auth w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md">
            <div className="flex items-center justify-center mb-6">
                <FaUnlock className="text-4xl text-gray-700 dark:text-gray-300 mr-2" />
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                    Enter Password
                </h2>
            </div>

            <p className="text-gray-600 dark:text-gray-300 mb-4">
                Enter your password to decrypt your GitHub token and access your
                pull requests.
            </p>

            <form
                onSubmit={handlePasswordEntry}
                className="space-y-4"
                autoComplete="on"
                name="password-entry-form"
            >
                <input
                    id="currentPassword"
                    name="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    aria-label="Enter your password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore="false"
                    data-lpignore="false"
                    data-bwignore="false"
                    data-form-type="password"
                    aria-describedby={passwordError ? 'password-error' : undefined}
                    {...(passwordError ? { 'aria-invalid': 'true' } : {})}
                    required
                />

                <div className="flex items-center">
                    <input
                        id="rememberPassword"
                        type="checkbox"
                        checked={rememberPassword}
                        onChange={(e) => setRememberPassword(e.target.checked)}
                        className="h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
                    />
                    <label
                        htmlFor="rememberPassword"
                        className="ml-2 block text-sm text-gray-600 dark:text-gray-300 flex items-center"
                    >
                        <FaClock className="mr-1 text-gray-500 dark:text-gray-400" />
                        Remember password for 12 hours
                    </label>
                </div>

                <button
                    type="submit"
                    className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors flex items-center justify-center"
                    aria-label="Sign In"
                >
                    <FaSignInAlt className="mr-2" />
                    Sign In
                </button>
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

            <button
                onClick={handleReset}
                className="w-full mt-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                aria-label="Reset App"
            >
                Reset App (Removes Saved Token)
            </button>
        </div>
    );
};
