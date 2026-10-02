export function formatLastChecked(
    timestamp: string | undefined,
    now: number
): string {
    const checkedAt = timestamp ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(checkedAt)) return 'Not checked yet';

    const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
    if (minutes < 1) return 'Checked just now';
    if (minutes < 60) return `Checked ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Checked ${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Checked yesterday';
    return `Checked ${days} days ago`;
}
