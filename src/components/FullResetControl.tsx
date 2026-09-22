import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';

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
            <Button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    setError('');
                    setIsOpen(true);
                }}
                variant="destructive"
                className="mt-4 w-full"
                aria-label="Full Reset"
                disabled={isSubmitting}
            >
                Full Reset
            </Button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <Card
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="full-reset-title"
                        aria-describedby="full-reset-description"
                        aria-busy={isSubmitting}
                        onKeyDown={handleDialogKeyDown}
                        className="w-full max-w-sm gap-0 p-5 shadow-xl"
                    >
                        <h2
                            id="full-reset-title"
                            className="text-xl font-bold text-card-foreground"
                        >
                            Reset PR Tracker?
                        </h2>
                        <div
                            id="full-reset-description"
                            className="mt-3 space-y-2 text-sm text-muted-foreground"
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
                                className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                                role="alert"
                            >
                                {error}
                            </p>
                        )}

                        <div className="mt-5 flex gap-3">
                            <Button
                                ref={cancelRef}
                                type="button"
                                onClick={closeDialog}
                                disabled={isSubmitting}
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                ref={confirmRef}
                                type="button"
                                onClick={confirmReset}
                                disabled={isSubmitting}
                                variant="destructive"
                                className="flex-1"
                            >
                                {isSubmitting ? 'Resetting…' : 'Full Reset'}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </>
    );
};
