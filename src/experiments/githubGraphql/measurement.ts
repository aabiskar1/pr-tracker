export type RequestMeasurement = {
    resource: string | null;
    endpoint: string;
    status: number;
    bodyBytes: number;
    elapsedMs: number;
    used: number | null;
};

// Body bytes are decoded bytes delivered to JavaScript, not compressed wire
// bytes. Buffering is identical for both clients and included in measured time.
export function instrumentTransport(
    transport: typeof fetch,
    maxRequests = 400,
    now = () => performance.now()
) {
    const requests: RequestMeasurement[] = [];
    let started = 0;
    const measuredFetch: typeof fetch = async (input, init) => {
        if (++started > maxRequests)
            throw new Error('Measurement request ceiling reached');
        const url = new URL(
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url
        );
        if (url.origin !== 'https://api.github.com')
            throw new Error('Unexpected measurement host');
        const start = now();
        const response = await transport(input, init);
        const body = new Uint8Array(await response.arrayBuffer());
        const usedHeader = response.headers.get('x-ratelimit-used');
        requests.push({
            resource: response.headers.get('x-ratelimit-resource'),
            endpoint:
                url.pathname === '/graphql'
                    ? 'graphql'
                    : url.pathname === '/user'
                      ? 'user'
                      : url.pathname === '/search/issues'
                        ? 'search'
                        : url.pathname.endsWith('/reviews')
                          ? 'reviews'
                          : url.pathname.endsWith('/check-runs')
                            ? 'check-runs'
                            : url.pathname.endsWith('/status')
                              ? 'status'
                              : 'detail',
            status: response.status,
            bodyBytes: body.byteLength,
            elapsedMs: now() - start,
            used:
                usedHeader !== null && /^\d+$/.test(usedHeader)
                    ? Number(usedHeader)
                    : null,
        });
        return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    };
    return {
        transport: measuredFetch,
        requests,
        get attemptedRequests() {
            return started;
        },
    };
}
