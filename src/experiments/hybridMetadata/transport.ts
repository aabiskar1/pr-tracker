import { assertRefreshSessionValid } from '../../background/refreshSession';
import {
    HybridMetadataError,
    fetchMetadata,
    type MetadataOptions,
    type MetadataResult,
} from './client';

// TOOLING ONLY: interception lets us exercise the unchanged production fetcher,
// including its exact REST discovery, four-worker scheduling, reviews and CI.
// One adapter instance belongs to one trial/session. Never install in an extension.
export function createHybridTransport(options: MetadataOptions) {
    const targets = new Set<string>();
    const fallbacks = new Map<string, Promise<Response>>();
    let pending: Promise<MetadataResult> | undefined;
    let fallbackRequests = 0;
    let failure: HybridMetadataError | undefined;
    const transport: typeof fetch = async (input, init) => {
        assertRefreshSessionValid(options.session);
        const url = new URL(
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url
        );
        if (url.origin !== 'https://api.github.com')
            throw new Error('Unexpected hybrid host');
        if (url.pathname === '/search/issues') {
            const response = await options.transport(input, init);
            assertRefreshSessionValid(options.session);
            // Discovery validation remains entirely in production. Invalid results
            // must not cause a GraphQL request before production rejects discovery.
            if (response.ok) {
                try {
                    const body = await response.clone().json();
                    assertRefreshSessionValid(options.session);
                    if (Array.isArray(body.items))
                        for (const item of body.items) {
                            if (typeof item?.pull_request?.url === 'string')
                                targets.add(item.pull_request.url);
                        }
                } catch {
                    assertRefreshSessionValid(options.session);
                }
            }
            return response;
        }
        if (
            /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(url.pathname) &&
            targets.has(url.href)
        ) {
            pending ??= fetchMetadata([...targets], options).catch(
                (error: unknown) => {
                    if (error instanceof HybridMetadataError) failure = error;
                    throw error;
                }
            );
            const metadata = await pending;
            assertRefreshSessionValid(options.session);
            const detail = metadata.details.get(url.href);
            if (detail) return Response.json(detail);
            if (!fallbacks.has(url.href)) {
                fallbackRequests++;
                fallbacks.set(url.href, options.transport(input, init));
            }
            const response = await fallbacks.get(url.href)!;
            assertRefreshSessionValid(options.session);
            return response.clone();
        }
        const response = await options.transport(input, init);
        assertRefreshSessionValid(options.session);
        return response;
    };
    return {
        transport,
        get fallbackRequests() {
            return fallbackRequests;
        },
        get metadata() {
            return pending;
        },
        get failure() {
            return failure;
        },
    };
}
