import React, { useState } from 'react';
import { FaLock, FaShieldAlt, FaQuestionCircle, FaClock, FaKey } from 'react-icons/fa';

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
        <div className="screen-auth w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md">
            <div className="flex items-center justify-center mb-6">
                <FaLock className="text-4xl text-gray-700 dark:text-gray-300 mr-2" />
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                    Create a Password
                </h2>
            </div>

            <p className="text-gray-600 dark:text-gray-300 mb-4">
                Create a password to encrypt your GitHub token. You'll need this
                password each time you open PR Tracker.
            </p>

            <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-md mb-4 flex items-start">
                <div className="flex-shrink-0 mt-1">
                    <FaShieldAlt className="text-blue-600 dark:text-blue-300" />
                </div>
                <div className="ml-3">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                        Your password is never stored anywhere. It's only used to
                        encrypt and decrypt your GitHub token.
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
                            className="text-sm text-gray-600 dark:text-gray-300 font-medium"
                        >
                            Password
                        </label>
                        <button
                            type="button"
                            className="text-xs text-primary flex items-center"
                            onClick={() => setShowPasswordHelp(!showPasswordHelp)}
                            aria-label="Password requirements"
                        >
                            <FaQuestionCircle className="mr-1" />
                            Requirements
                        </button>
                    </div>

                    {showPasswordHelp && (
                        <div
                            className="text-xs text-gray-600 dark:text-gray-300 mb-2 p-2 bg-gray-100 dark:bg-gray-700 rounded"
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

                    <input
                        id="newPassword"
                        name="new-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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
                        className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-1 block"
                    >
                        Confirm Password
                    </label>
                    <input
                        id="confirmNewPassword"
                        name="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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
                    aria-label="Create Password"
                >
                    <FaKey className="mr-2" />
                    Create Password & Encrypt Token
                </button>
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

            <button
                onClick={onBack}
                className="w-full mt-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                aria-label="Go Back"
            >
                Go Back
            </button>
        </div>
    );
};
