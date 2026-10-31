import { z } from 'zod';
import {
    assertRefreshSessionValid,
    type RefreshSessionContext,
} from '../../background/refreshSession';
import {
    deriveGitHubRateLimitCooldown,
    type GitHubRateLimitCooldown,
} from '../../utils/githubRateLimit';

export const DEFAULT_BATCH_SIZE = 20;
export const MAX_BATCH_SIZE = 50;
export type Target = {
    url: string;
    owner: string;
    repo: string;
    number: number;
};
export function targetFromUrl(url: string): Target {
    const parsed = new URL(url);
    const match = /^\/repos\/([\w.-]+)\/([\w.-]+)\/pulls\/([1-9]\d*)$/.exec(
        parsed.pathname
    );
    if (
        parsed.origin !== 'https://api.github.com' ||
        parsed.search ||
        parsed.hash ||
        !match ||
        !Number.isSafeInteger(Number(match[3]))
    )
        throw new Error('Invalid canonical PR target');
    return { url, owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}
const actor = z.object({
    login: z.string().min(1),
    avatarUrl: z.string().url(),
});
const repository = z.object({
    name: z.string().min(1),
    nameWithOwner: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    url: z.string().url(),
});
const reviewer = z.union([
    actor.extend({ __typename: z.enum(['User', 'Bot', 'Mannequin']) }),
    z.object({
        __typename: z.enum(['Team', 'EnterpriseTeam']),
        slug: z.string().optional(),
    }),
]);
const nodeSchema = z.object({
    __typename: z.literal('PullRequest'),
    fullDatabaseId: z
        .union([z.number(), z.string().regex(/^[1-9]\d*$/)])
        .transform(Number)
        .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
    number: z.number().int().positive(),
    title: z.string(),
    url: z.string().url(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    isDraft: z.boolean(),
    author: actor.nullable(),
    repository,
    baseRepository: repository,
    headRefOid: z.string().regex(/^[a-f0-9]{40}$/),
    headRepository: repository.nullable(),
    reviewRequests: z.object({
        totalCount: z.number().int().nonnegative(),
        pageInfo: z.object({ hasNextPage: z.literal(false) }),
        nodes: z.array(z.object({ requestedReviewer: reviewer })).max(100),
    }),
});
export const rateSchema = z.object({
    cost: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    resetAt: z.iso.datetime(),
});
export type RateUsage = z.infer<typeof rateSchema>;
export type CanonicalDetail = {
    id: number;
    number: number;
    title: string;
    html_url: string;
    created_at: string;
    updated_at: string;
    state: string;
    merged: boolean;
    draft: boolean;
    user: { login: string; avatar_url: string } | null;
    requested_reviewers: { login: string; avatar_url: string }[];
    requested_teams: { slug?: string }[];
    base: {
        repo: {
            name: string;
            full_name: string;
            url: string;
            html_url: string;
        };
    };
    head: {
        sha: string;
        repo: {
            name: string;
            full_name: string;
            url: string;
            html_url: string;
        } | null;
    };
};
const restRepo = (repo: z.infer<typeof repository>) => ({
    name: repo.name,
    full_name: repo.nameWithOwner,
    url: `https://api.github.com/repos/${repo.nameWithOwner}`,
    html_url: repo.url,
});
export function mapMetadata(value: unknown, target: Target): CanonicalDetail {
    const node = nodeSchema.parse(value);
    if (
        node.number !== target.number ||
        node.repository.nameWithOwner.toLowerCase() !==
            `${target.owner}/${target.repo}`.toLowerCase() ||
        node.baseRepository.nameWithOwner !== node.repository.nameWithOwner ||
        node.url !==
            `https://github.com/${node.repository.nameWithOwner}/pull/${node.number}` ||
        node.reviewRequests.totalCount !== node.reviewRequests.nodes.length
    )
        throw new Error('Inconsistent or incomplete canonical metadata');
    const repositories = [
        node.repository,
        node.baseRepository,
        ...(node.headRepository ? [node.headRepository] : []),
    ];
    if (
        repositories.some(
            (repo) =>
                repo.name !== repo.nameWithOwner.split('/')[1] ||
                repo.url !== `https://github.com/${repo.nameWithOwner}`
        )
    )
        throw new Error('Inconsistent repository metadata');
    const reviewers = node.reviewRequests.nodes.map(
        (request) => request.requestedReviewer
    );
    const individual = reviewers.filter((r) => 'login' in r);
    if (new Set(individual.map((r) => r.login)).size !== individual.length)
        throw new Error('Duplicate reviewer');
    return {
        id: node.fullDatabaseId,
        number: node.number,
        title: node.title,
        html_url: node.url,
        created_at: node.createdAt,
        updated_at: node.updatedAt,
        state: node.state === 'OPEN' ? 'open' : 'closed',
        merged: node.state === 'MERGED',
        draft: node.isDraft,
        user: node.author
            ? { login: node.author.login, avatar_url: node.author.avatarUrl }
            : null,
        requested_reviewers: individual.map((r) => ({
            login: r.login,
            avatar_url: r.avatarUrl,
        })),
        requested_teams: reviewers
            .filter((r) => !('login' in r))
            .map((r) => ({ ...('slug' in r ? { slug: r.slug } : {}) })),
        base: { repo: restRepo(node.baseRepository) },
        head: {
            sha: node.headRefOid,
            repo: node.headRepository ? restRepo(node.headRepository) : null,
        },
    };
}
export function metadataQuery(targets: readonly Target[]) {
    if (!targets.length || targets.length > MAX_BATCH_SIZE)
        throw new Error('Invalid metadata batch size');
    const variables: Record<string, string | number> = {};
    const declarations: string[] = [];
    const fields = targets.map((target, index) => {
        declarations.push(
            `$o${index}:String!`,
            `$r${index}:String!`,
            `$n${index}:Int!`
        );
        variables[`o${index}`] = target.owner;
        variables[`r${index}`] = target.repo;
        variables[`n${index}`] = target.number;
        return `p${index}:repository(owner:$o${index},name:$r${index}) { pullRequest(number:$n${index}) {
          __typename fullDatabaseId number title url createdAt updatedAt state isDraft headRefOid
          author { login avatarUrl }
          repository { name nameWithOwner url }
          baseRepository { name nameWithOwner url }
          headRepository { name nameWithOwner url }
          reviewRequests(first:100) { totalCount pageInfo { hasNextPage } nodes { requestedReviewer {
            __typename ... on User { login avatarUrl } ... on Bot { login avatarUrl }
            ... on Mannequin { login avatarUrl } ... on Team { slug }
          } } }
        } }`;
    });
    return {
        query: `query TrackerHybridMetadata(${declarations.join(',')}) { ${fields.join('\n')} rateLimit { cost remaining resetAt } }`,
        variables,
    };
}
export class HybridMetadataError extends Error {
    constructor(
        public readonly kind: 'rate-limit' | 'access',
        public readonly cooldown?: GitHubRateLimitCooldown
    ) {
        super(`Hybrid metadata ${kind}; preserve the last successful snapshot`);
        this.name = 'HybridMetadataError';
    }
}
export type MetadataOptions = {
    token: string;
    transport: typeof fetch;
    session?: RefreshSessionContext;
    batchSize?: number;
};
export type MetadataResult = {
    details: Map<string, CanonicalDetail>;
    fallbackUrls: Set<string>;
    rateUsage: RateUsage[];
};
const envelopeSchema = z.object({
    data: z.record(z.string(), z.unknown()).nullish(),
    errors: z
        .array(
            z.object({
                type: z.string().optional(),
                message: z.string().optional(),
                path: z.array(z.union([z.string(), z.number()])).optional(),
            })
        )
        .optional(),
});
export async function fetchMetadata(
    urls: readonly string[],
    options: MetadataOptions
): Promise<MetadataResult> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    if (
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > MAX_BATCH_SIZE
    )
        throw new Error('Invalid batch size');
    const targets = [...new Set(urls)].map(targetFromUrl);
    if (targets.length > 3000)
        throw new Error('Metadata target ceiling exceeded');
    const result: MetadataResult = {
        details: new Map(),
        fallbackUrls: new Set(),
        rateUsage: [],
    };
    for (let offset = 0; offset < targets.length; offset += batchSize) {
        assertRefreshSessionValid(options.session);
        const batch = targets.slice(offset, offset + batchSize);
        try {
            const response = await options.transport(
                'https://api.github.com/graphql',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${options.token}`,
                        'Content-Type': 'application/json',
                    },
                    signal: options.session?.signal,
                    body: JSON.stringify(metadataQuery(batch)),
                }
            );
            assertRefreshSessionValid(options.session);
            const text = await response.text();
            assertRefreshSessionValid(options.session);
            let cooldown = deriveGitHubRateLimitCooldown(response, text);
            let body: unknown;
            try {
                body = JSON.parse(text);
            } catch {
                body = undefined;
            }
            const envelope = envelopeSchema.safeParse(body);
            const errors = envelope.success ? (envelope.data.errors ?? []) : [];
            const limited =
                errors.some((e) => e.type === 'RATE_LIMITED') ||
                response.headers.get('x-ratelimit-remaining') === '0';
            if (limited && !cooldown) {
                const headers = new Headers(response.headers);
                headers.set('x-ratelimit-remaining', '0');
                headers.set('x-ratelimit-resource', 'graphql');
                cooldown = deriveGitHubRateLimitCooldown(
                    new Response(null, { status: 403, headers }),
                    'API rate limit exceeded'
                );
            }
            if (limited && cooldown && cooldown.classification === 'generic')
                cooldown = { ...cooldown, classification: 'primary' };
            if (limited || cooldown)
                throw new HybridMetadataError(
                    'rate-limit',
                    cooldown ?? undefined
                );
            if (
                [401, 403].includes(response.status) ||
                errors.some((e) =>
                    ['FORBIDDEN', 'UNAUTHORIZED'].includes(e.type ?? '')
                )
            )
                throw new HybridMetadataError('access');
            if (!response.ok || !envelope.success || !envelope.data.data)
                throw new Error('Unusable metadata envelope');
            const data = envelope.data.data;
            const rate = rateSchema.safeParse(data.rateLimit);
            if (!rate.success)
                throw new Error('Missing GraphQL cost telemetry');
            result.rateUsage.push(rate.data);
            if (
                rate.data.remaining === 0 &&
                offset + batch.length < targets.length
            ) {
                const headers = new Headers(response.headers);
                headers.set('x-ratelimit-remaining', '0');
                headers.set('x-ratelimit-resource', 'graphql');
                headers.set(
                    'x-ratelimit-reset',
                    String(Date.parse(rate.data.resetAt) / 1000)
                );
                throw new HybridMetadataError(
                    'rate-limit',
                    deriveGitHubRateLimitCooldown(
                        new Response(null, { status: 403, headers }),
                        'API rate limit exceeded'
                    ) ?? undefined
                );
            }
            const globalError = errors.some(
                (e) => !batch.some((_, index) => e.path?.[0] === `p${index}`)
            );
            for (let index = 0; index < batch.length; index++) {
                const target = batch[index]!;
                try {
                    if (
                        globalError ||
                        errors.some((e) => e.path?.[0] === `p${index}`)
                    )
                        throw new Error('Partial metadata');
                    const alias = z
                        .object({ pullRequest: z.unknown() })
                        .parse(data[`p${index}`]);
                    const detail = mapMetadata(alias.pullRequest, target);
                    if (
                        [...result.details.values()].some(
                            (other) => other.id === detail.id
                        )
                    )
                        throw new Error('Conflicting numeric PR identity');
                    result.details.set(target.url, detail);
                } catch {
                    result.fallbackUrls.add(target.url);
                }
            }
        } catch (error) {
            assertRefreshSessionValid(options.session);
            if (error instanceof HybridMetadataError) throw error;
            for (const target of batch) result.fallbackUrls.add(target.url);
        }
    }
    assertRefreshSessionValid(options.session);
    return result;
}
