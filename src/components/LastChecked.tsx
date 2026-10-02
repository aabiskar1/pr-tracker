import { useEffect, useState } from 'react';
import { formatLastChecked } from '../utils/lastChecked';

export function LastChecked({
    lastSuccessfulRefreshAt,
}: {
    lastSuccessfulRefreshAt?: string;
}) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        setNow(Date.now());
        if (!lastSuccessfulRefreshAt) return;
        const interval = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(interval);
    }, [lastSuccessfulRefreshAt]);

    const date = lastSuccessfulRefreshAt
        ? new Date(lastSuccessfulRefreshAt)
        : undefined;
    const exactTime =
        date && Number.isFinite(date.getTime())
            ? date.toLocaleString()
            : undefined;
    const label = formatLastChecked(lastSuccessfulRefreshAt, now);

    return (
        <span
            data-testid="last-checked"
            className="text-xs text-muted-foreground"
            aria-label={
                label === 'Not checked yet'
                    ? label
                    : `Last ${label.toLowerCase()}`
            }
            title={exactTime ? `Last checked ${exactTime}` : undefined}
        >
            {label}
        </span>
    );
}
