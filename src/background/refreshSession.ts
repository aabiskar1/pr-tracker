export type RefreshSessionContext = {
    signal: AbortSignal;
    isValid: () => boolean;
};

export class RefreshSessionInvalidatedError extends Error {
    constructor() {
        super('Refresh session was invalidated');
        this.name = 'RefreshSessionInvalidatedError';
    }
}

export function assertRefreshSessionValid(
    context?: RefreshSessionContext
): void {
    if (context && (context.signal.aborted || !context.isValid())) {
        throw new RefreshSessionInvalidatedError();
    }
}

export function isRefreshSessionInvalidated(
    error: unknown,
    context?: RefreshSessionContext
): boolean {
    return (
        error instanceof RefreshSessionInvalidatedError ||
        Boolean(context && (context.signal.aborted || !context.isValid()))
    );
}
