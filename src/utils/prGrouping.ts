import type { PullRequest } from '../types';

// GitHub owner/repository names, not arbitrary paths or URLs.
export function validatedRepositoryName(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 256) return undefined;
    return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/[a-z\d_.-]{1,100}$/i.test(
        value
    ) && !['.', '..'].includes(value.split('/')[1] ?? '')
        ? value
        : undefined;
}

export function repositoryNameFromUrl(value: string): string | undefined {
    try {
        const url = new URL(value);
        if (
            url.origin !== 'https://github.com' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !/^\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?$/.test(url.pathname)
        )
            return undefined;
        return validatedRepositoryName(
            url.pathname.split('/').slice(1, 3).join('/')
        );
    } catch {
        return undefined;
    }
}

export function activityTimestamp(value: unknown): number | undefined {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    )
        return undefined;
    const timestamp = Date.parse(value);
    // Reject dates that Date.parse silently normalises (for example February 30).
    if (
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)
    )
        return undefined;
    return timestamp;
}

export type RepositoryGroup = {
    key: string;
    name: string;
    persistable: boolean;
    pullRequests: PullRequest[];
    latestActivity?: number;
    activityComplete: boolean;
};

export function repositoryIdentity(pr: PullRequest) {
    const name =
        validatedRepositoryName(pr.repository?.full_name) ??
        repositoryNameFromUrl(pr.html_url);
    return name
        ? { key: name.toLowerCase(), name, persistable: true }
        : {
              key: `unavailable:${pr.id}`,
              name: 'Repository unavailable',
              persistable: false,
          };
}

export function groupPullRequests(
    pullRequests: PullRequest[]
): RepositoryGroup[] {
    const groups = new Map<string, RepositoryGroup>();
    for (const pr of pullRequests) {
        const identity = repositoryIdentity(pr);
        let group = groups.get(identity.key);
        if (!group) {
            group = { ...identity, pullRequests: [], activityComplete: true };
            groups.set(group.key, group);
        }
        group.pullRequests.push(pr);
        const timestamp = activityTimestamp(pr.updated_at);
        if (timestamp === undefined) group.activityComplete = false;
        else
            group.latestActivity = Math.max(
                group.latestActivity ?? timestamp,
                timestamp
            );
    }
    return [...groups.values()].sort((a, b) => {
        if (a.activityComplete !== b.activityComplete)
            return a.activityComplete ? -1 : 1;
        if (a.activityComplete && a.latestActivity !== b.latestActivity)
            return b.latestActivity! - a.latestActivity!;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}
