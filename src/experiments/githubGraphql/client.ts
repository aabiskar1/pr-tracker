import { z } from 'zod';
import type { PullRequest } from '../../types';

// Investigation only: no production entrypoint imports this module. Transport
// is mandatory so tests cannot accidentally fall through to a live request.
export const PAGE_SIZE = 50;
const SEARCH_LIMIT = 1000;
export const SEARCH_QUERY = `
query TrackerSearch($query: String!, $after: String) {
  search(query: $query, type: ISSUE, first: ${PAGE_SIZE}, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        fullDatabaseId title url state isDraft createdAt
        repository { name }
        author { login avatarUrl }
        reviewDecision
        statusCheckRollup { state }
        reviewRequests(first: 100) {
          pageInfo { hasNextPage }
          nodes {
            requestedReviewer {
              __typename
              ... on User { login avatarUrl }
              ... on Bot { login avatarUrl }
              ... on Mannequin { login avatarUrl }
            }
          }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`;

const actor = z.object({ login: z.string(), avatarUrl: z.string() });
const numericId = z
    .union([z.number(), z.string().regex(/^[1-9]\d*$/)])
    .transform(Number)
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const reviewer = z.union([
    actor.extend({ __typename: z.enum(['User', 'Bot', 'Mannequin']) }),
    z.object({ __typename: z.enum(['Team', 'EnterpriseTeam']) }),
]);
const nodeSchema = z.object({
    __typename: z.literal('PullRequest'),
    fullDatabaseId: numericId,
    title: z.string(),
    url: z.string().url(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    isDraft: z.boolean(),
    createdAt: z.iso.datetime(),
    repository: z.object({ name: z.string().min(1) }),
    author: actor.nullable(),
    reviewDecision: z
        .enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])
        .nullable(),
    statusCheckRollup: z
        .object({
            state: z.enum([
                'SUCCESS',
                'FAILURE',
                'ERROR',
                'PENDING',
                'EXPECTED',
            ]),
        })
        .nullable(),
    reviewRequests: z.object({
        pageInfo: z.object({ hasNextPage: z.literal(false) }),
        nodes: z.array(z.object({ requestedReviewer: reviewer })).max(100),
    }),
});
const rateLimitSchema = z.object({
    cost: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    resetAt: z.iso.datetime(),
});
const envelopeSchema = z.object({
    errors: z.array(z.unknown()).optional(),
    data: z.unknown().optional(),
});
const dataSchema = z.object({
    search: z.object({
        issueCount: z.number().int().nonnegative(),
        pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
        }),
        nodes: z.array(nodeSchema).max(PAGE_SIZE),
    }),
    rateLimit: rateLimitSchema,
});

export class GraphqlInvestigationError extends Error {
    constructor(
        message: string,
        // Retain headers and the unconsumed body for a future cooldown adapter.
        public readonly response?: Response
    ) {
        super(message);
        this.name = 'GraphqlInvestigationError';
    }
}

function mapNode(node: z.infer<typeof nodeSchema>): PullRequest {
    const review = node.reviewDecision;
    const ci = node.statusCheckRollup?.state;
    return {
        id: node.fullDatabaseId,
        title: node.title,
        html_url: node.url,
        repository: node.repository,
        state: node.state === 'OPEN' ? 'open' : 'closed',
        draft: node.isDraft,
        created_at: node.createdAt,
        author: node.author
            ? { login: node.author.login, avatar_url: node.author.avatarUrl }
            : undefined,
        requested_reviewers: node.reviewRequests.nodes.flatMap(
            ({ requestedReviewer: r }) =>
                'login' in r
                    ? [{ login: r.login, avatar_url: r.avatarUrl }]
                    : []
        ),
        // These summaries deliberately explore different semantics from REST.
        review_status:
            review === 'APPROVED'
                ? 'approved'
                : review === 'CHANGES_REQUESTED'
                  ? 'changes-requested'
                  : 'pending',
        ci_status:
            ci === 'SUCCESS'
                ? 'passing'
                : ci === 'FAILURE' || ci === 'ERROR'
                  ? 'failing'
                  : 'pending',
    };
}

export async function investigateGraphql(options: {
    token: string;
    login: string;
    customQuery?: string;
    transport: typeof fetch;
    signal?: AbortSignal;
}): Promise<{
    pullRequests: PullRequest[];
    rateLimits: z.infer<typeof rateLimitSchema>[];
    truncated: boolean;
}> {
    const { token, login, transport, signal } = options;
    const custom = options.customQuery?.trim();
    const searches: {
        query: string;
        source?: NonNullable<PullRequest['discoverySources']>[number];
    }[] = custom
        ? [{ query: options.customQuery! }]
        : [
              {
                  query: `is:open is:pr author:${login} archived:false`,
                  source: 'authored',
              },
              {
                  query: `is:open is:pr review-requested:${login} archived:false`,
                  source: 'review-requested',
              },
              {
                  query: `is:open is:pr reviewed-by:${login} archived:false`,
                  source: 'reviewed',
              },
          ];
    const byId = new Map<number, PullRequest>();
    const rateLimits: z.infer<typeof rateLimitSchema>[] = [];
    let truncated = false;

    // One request at a time; bounded pages and no automatic retries or sleeps.
    for (const { query, source } of searches) {
        let after: string | null = null;
        let received = 0;
        let target: number | undefined;
        const cursors = new Set<string>();
        const identities = new Set<number>();
        while (received < (target ?? SEARCH_LIMIT)) {
            signal?.throwIfAborted();
            const response = await transport('https://api.github.com/graphql', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: SEARCH_QUERY,
                    variables: { query, after },
                }),
                signal,
            });
            signal?.throwIfAborted();
            if (!response.ok)
                throw new GraphqlInvestigationError(
                    `GraphQL HTTP ${response.status}`,
                    response
                );
            const envelope = envelopeSchema.parse(
                await response.clone().json()
            );
            signal?.throwIfAborted();
            if (envelope.errors?.length) {
                // Includes HTTP 200 rate limits and partial data. Never return
                // a publishable partial snapshot or echo server/token content.
                throw new GraphqlInvestigationError(
                    'GraphQL returned errors; discard this refresh',
                    response
                );
            }
            const { search, rateLimit } = dataSchema.parse(envelope.data);
            rateLimits.push(rateLimit);
            target ??= Math.min(search.issueCount, SEARCH_LIMIT);
            truncated ||= search.issueCount > SEARCH_LIMIT;
            received += search.nodes.length;
            if (received > target)
                throw new GraphqlInvestigationError(
                    'Inconsistent search count'
                );
            for (const node of search.nodes) {
                const pr = mapNode(node);
                if (identities.has(pr.id)) {
                    throw new GraphqlInvestigationError(
                        'Duplicate search result'
                    );
                }
                identities.add(pr.id);
                if (!custom && pr.state !== 'open') continue;
                const previous = byId.get(pr.id);
                if (previous && previous.html_url !== pr.html_url)
                    throw new GraphqlInvestigationError(
                        'Conflicting PR identity'
                    );
                if (source)
                    pr.discoverySources = [
                        ...new Set([
                            ...(previous?.discoverySources ?? []),
                            source,
                        ]),
                    ];
                byId.set(pr.id, pr);
            }
            if (received === target) {
                if (target < SEARCH_LIMIT && search.pageInfo.hasNextPage)
                    throw new GraphqlInvestigationError(
                        'Inconsistent search continuation'
                    );
                break;
            }
            const cursor = search.pageInfo.endCursor;
            if (
                !search.pageInfo.hasNextPage ||
                !cursor ||
                cursors.has(cursor) ||
                search.nodes.length === 0
            ) {
                throw new GraphqlInvestigationError(
                    'Incomplete search pagination'
                );
            }
            cursors.add(cursor);
            after = cursor;
        }
    }
    return { pullRequests: [...byId.values()], rateLimits, truncated };
}
