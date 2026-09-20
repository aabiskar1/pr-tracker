import React, { useEffect, useRef, useState } from 'react';

interface FullResetControlProps {
    onConfirm: () => Promise<boolean>;
}

export const FullResetControl: React.FC<FullResetControlProps> = ({
    onConfirm,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const triggerRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const resetInFlightRef = useRef(false);

    useEffect(() => {
        if (isOpen) cancelRef.current?.focus();
    }, [isOpen]);

    const closeDialog = () => {
        if (resetInFlightRef.current) return;
        setIsOpen(false);
        setError('');
        triggerRef.current?.focus();
    };

    const handleDialogKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
            return;
        }

        if (event.key !== 'Tab') return;
        if (event.shiftKey && document.activeElement === cancelRef.current) {
            event.preventDefault();
            confirmRef.current?.focus();
        } else if (
            !event.shiftKey &&
            document.activeElement === confirmRef.current
        ) {
            event.preventDefault();
            cancelRef.current?.focus();
        }
    };

    const confirmReset = async () => {
        if (resetInFlightRef.current) return;
        resetInFlightRef.current = true;
        setIsSubmitting(true);
        setError('');

        try {
            if (await onConfirm()) {
                setIsOpen(false);
            } else {
                setError(
                    'Full Reset could not be completed. Please try again.'
                );
            }
        } catch {
            setError('Full Reset could not be completed. Please try again.');
        } finally {
            resetInFlightRef.current = false;
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    setError('');
                    setIsOpen(true);
                }}
                className="w-full mt-4 bg-red-600 dark:bg-red-700 text-white py-2 px-4 rounded-md hover:bg-red-700 dark:hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                aria-label="Full Reset"
                disabled={isSubmitting}
            >
                Full Reset
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="full-reset-title"
                        aria-describedby="full-reset-description"
                        aria-busy={isSubmitting}
                        onKeyDown={handleDialogKeyDown}
                        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800"
                    >
                        <h2
                            id="full-reset-title"
                            className="text-xl font-bold text-gray-900 dark:text-white"
                        >
                            Reset PR Tracker?
                        </h2>
                        <div
                            id="full-reset-description"
                            className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300"
                        >
                            <p>
                                This deletes your saved GitHub token, encrypted
                                PR data, notification history, and account
                                settings.
                            </p>
                            <p>Your theme preference will be retained.</p>
                            <p>
                                You will need to enter your GitHub token and
                                create a password again.
                            </p>
                        </div>

                        {error && (
                            <p
                                className="mt-4 rounded-md bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
                                role="alert"
                            >
                                {error}
                            </p>
                        )}

                        <div className="mt-5 flex gap-3">
                            <button
                                ref={cancelRef}
                                type="button"
                                onClick={closeDialog}
                                disabled={isSubmitting}
                                className="flex-1 rounded-md bg-primary px-4 py-2 font-medium text-white hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                ref={confirmRef}
                                type="button"
                                onClick={confirmReset}
                                disabled={isSubmitting}
                                className="flex-1 rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:bg-red-700 dark:hover:bg-red-600 dark:focus-visible:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSubmitting ? 'Resetting…' : 'Full Reset'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
