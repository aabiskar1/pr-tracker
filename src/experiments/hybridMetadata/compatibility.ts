import { z } from 'zod';
import type { CanonicalDetail } from './client';
import type { PullRequest } from '../../types';

// Evidence comes only from this trial's successful REST discovery responses.
// A login, avatar path, or stripped query string is never an identity proof.
const discoverySchema = z.object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    node_id: z.string().min(1),
    updated_at: z.iso.datetime(),
    user: z
        .object({
            node_id: z.string().min(1),
            login: z.string().min(1),
            avatar_url: z.string().url(),
            type: z.enum(['User', 'Bot']),
        })
        .nullable(),
});
export type AuthorEvidence = z.infer<typeof discoverySchema>;
export class AuthorCompatibilityError extends Error {
    constructor(
        public readonly reason:
            | 'discovery-unavailable'
            | 'discovery-stale'
            | 'pr-identity'
            | 'author-identity'
    ) {
        super(`Unverified metadata: ${reason}`);
    }
}
export function discoveryAuthor(value: unknown): AuthorEvidence | null {
    const parsed = discoverySchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
export function preserveRestAuthor(
    detail: CanonicalDetail,
    rawNode: unknown,
    evidence: AuthorEvidence | null | undefined
): CanonicalDetail {
    if (!evidence) throw new AuthorCompatibilityError('discovery-unavailable');
    if (evidence.updated_at !== detail.updated_at)
        throw new AuthorCompatibilityError('discovery-stale');
    const node = z
        .object({
            id: z.string().min(1),
            author: z
                .object({
                    id: z.string().min(1),
                    __typename: z.enum(['User', 'Bot']),
                    login: z.string().min(1),
                })
                .nullable(),
        })
        .parse(rawNode);
    // Search/issues numeric IDs identify issues, not REST canonical pull requests.
    // Compare PR global IDs instead; fullDatabaseId remains the canonical numeric ID.
    if (evidence.node_id !== node.id)
        throw new AuthorCompatibilityError('pr-identity');
    if (evidence.user === null && node.author === null)
        return { ...detail, user: null };
    if (
        !evidence.user ||
        !node.author ||
        evidence.user.node_id !== node.author.id ||
        evidence.user.type !== node.author.__typename ||
        evidence.user.login !== node.author.login
    )
        throw new AuthorCompatibilityError('author-identity');
    return {
        ...detail,
        user: {
            login: evidence.user.login,
            avatar_url: evidence.user.avatar_url,
        },
    };
}

// Verified consumers use only these reviewer fields, their order and count.
// Keep raw-object comparisons too: projection is an explicit compatibility policy.
export function consumedPullRequests(prs: PullRequest[]): PullRequest[] {
    return prs.map((pr) => ({
        ...pr,
        requested_reviewers: pr.requested_reviewers.map((r) => ({
            login: r.login,
            avatar_url: r.avatar_url,
        })),
    }));
}

export function canonicalProjection(detail: CanonicalDetail) {
    const repo = (r: CanonicalDetail['base']['repo'] | null) =>
        r
            ? {
                  name: r.name,
                  full_name: r.full_name,
                  url: r.url,
                  html_url: r.html_url,
              }
            : null;
    return {
        id: detail.id,
        number: detail.number,
        title: detail.title,
        html_url: detail.html_url,
        created_at: detail.created_at,
        updated_at: detail.updated_at,
        state: detail.state,
        merged: detail.merged,
        draft: detail.draft,
        user: detail.user
            ? { login: detail.user.login, avatar_url: detail.user.avatar_url }
            : null,
        requested_reviewers: detail.requested_reviewers.map((r) => ({
            login: r.login,
            avatar_url: r.avatar_url,
        })),
        requested_teams: detail.requested_teams.map((r) => ({ slug: r.slug })),
        base: { repo: repo(detail.base.repo) },
        head: { sha: detail.head.sha, repo: repo(detail.head.repo) },
    };
}
export function canonicalDifferences(
    rest: ReadonlyMap<string, CanonicalDetail>,
    hybrid: ReadonlyMap<string, CanonicalDetail>
) {
    const fields: Record<string, number> = {};
    for (const [url, detail] of rest) {
        const other = hybrid.get(url);
        if (!other) {
            fields.missing = (fields.missing ?? 0) + 1;
            continue;
        }
        const a = canonicalProjection(detail);
        const b = canonicalProjection(other);
        for (const key of Object.keys(a) as (keyof typeof a)[])
            if (JSON.stringify(a[key]) !== JSON.stringify(b[key]))
                fields[key] = (fields[key] ?? 0) + 1;
    }
    const extra = [...hybrid.keys()].filter((url) => !rest.has(url)).length;
    if (extra) fields.extra = extra;
    return fields;
}
