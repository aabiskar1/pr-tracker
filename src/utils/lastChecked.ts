export function formatLastChecked(
    timestamp: string | undefined,
    now: number
): string {
    const checkedAt = timestamp ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(checkedAt)) return 'Not checked yet';

    const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
    if (minutes < 1) return 'Last checked just now';
    if (minutes < 60) return `Last checked ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Last checked ${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Last checked yesterday';
    return `Last checked ${days} days ago`;
}
