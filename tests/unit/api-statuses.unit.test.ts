import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPullRequests } from '../../src/background/api';
import {
    TOKEN,
    USER,
    createNotificationMock,
    installFetch,
    jsonResponse,
    prDetail,
    prUrl,
    searchItem,
    searchResponse,
} from './api-test-helpers';

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

type EndpointResult = {
    body: unknown;
    status?: number;
    headers?: HeadersInit;
};

type Scenario = {
    reviews?: EndpointResult | Error;
    canonicalDetail?: EndpointResult | Error;
    checks?: EndpointResult | Error;
    combinedStatus?: EndpointResult | Error;
};

const endpointResponse = (
    result: EndpointResult | Error | undefined,
    defaultBody: unknown
): Response => {
    if (result instanceof Error) throw result;
    return jsonResponse(
        result?.body ?? defaultBody,
        result?.status,
        result?.headers
    );
};

const runScenario = async (scenario: Scenario = {}) => {
    const targetPrUrl = prUrl(40);
    const requestedUrls: string[] = [];

    installFetch((url) => {
        requestedUrls.push(url);
        if (url.startsWith('https://api.github.com/search/issues?')) {
            return searchResponse([searchItem(40)]);
        }
        if (url === `${targetPrUrl}/reviews`) {
            return endpointResponse(scenario.reviews, []);
        }
        if (url.includes('/check-runs')) {
            return endpointResponse(scenario.checks, {
                check_runs: [
                    {
                        status: 'completed',
                        conclusion: 'success',
                    },
                ],
            });
        }
        if (url.endsWith('/status')) {
            return endpointResponse(scenario.combinedStatus, {
                state: 'pending',
            });
        }
        if (url === targetPrUrl) {
            return endpointResponse(scenario.canonicalDetail, prDetail(40));
        }
        throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await fetchPullRequests(
        TOKEN,
        USER,
        'is:pr repo:acme/repo-40',
        createNotificationMock()
    );

    expect(result.status).toBe('success');
    if (result.status === 'failure') {
        throw new Error('Expected a successful pull-request search');
    }
    expect(result.pullRequests).toHaveLength(1);
    return {
        pullRequest: result.pullRequests[0],
        requestedUrls,
        rateLimit: result.rateLimit,
    };
};

describe('fetchPullRequests review-status reduction', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        {
            label: 'approved',
            reviews: [{ user: { id: 1 }, state: 'APPROVED' }],
            expected: 'approved',
        },
        {
            label: 'changes requested',
            reviews: [{ user: { id: 1 }, state: 'CHANGES_REQUESTED' }],
            expected: 'changes-requested',
        },
        {
            label: 'pending',
            reviews: [{ user: { id: 1 }, state: 'COMMENTED' }],
            expected: 'pending',
        },
    ])('reduces reviews to $label', async ({ reviews, expected }) => {
        const { pullRequest } = await runScenario({
            reviews: { body: reviews },
        });

        expect(pullRequest.review_status).toBe(expected);
    });

    it('uses the latest review from the same user', async () => {
        const { pullRequest } = await runScenario({
            reviews: {
                body: [
                    { user: { id: 7 }, state: 'CHANGES_REQUESTED' },
                    { user: { id: 7 }, state: 'APPROVED' },
                    { user: { id: 8 }, state: 'COMMENTED' },
                ],
            },
        });

        expect(pullRequest.review_status).toBe('approved');
    });

    it('returns pending when the review request fails', async () => {
        const { pullRequest, rateLimit } = await runScenario({
            reviews: { body: { message: 'server error' }, status: 500 },
        });

        expect(pullRequest.review_status).toBe('pending');
        expect(rateLimit).toBeUndefined();
    });

    it('keeps reviews pending and propagates a recognized rate limit', async () => {
        vi.useFakeTimers();
        vi.setSystemTime('2030-06-07T08:09:10.000Z');

        const { pullRequest, rateLimit } = await runScenario({
            reviews: {
                body: { message: 'You have exceeded a secondary rate limit.' },
                status: 429,
                headers: { 'retry-after': '90' },
            },
        });

        expect(pullRequest.review_status).toBe('pending');
        expect(rateLimit).toEqual({
            classification: 'secondary',
            nextAllowedAt: new Date('2030-06-07T08:10:40.000Z').getTime(),
            deadlineSource: 'retry-after',
        });
    });

    it('returns pending when fetching reviews rejects', async () => {
        const { pullRequest } = await runScenario({
            reviews: new TypeError('review network failure'),
        });

        expect(pullRequest.review_status).toBe('pending');
        expect(console.error).toHaveBeenCalledWith(
            'Error fetching review status:',
            expect.any(TypeError)
        );
    });
});

describe('fetchPullRequests CI-status reduction', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('requests canonical detail, reviews, and check runs exactly once', async () => {
        const { requestedUrls } = await runScenario();
        const targetPrUrl = prUrl(40);

        expect(requestedUrls.filter((url) => url === targetPrUrl)).toHaveLength(
            1
        );
        expect(
            requestedUrls.filter((url) => url === `${targetPrUrl}/reviews`)
        ).toHaveLength(1);
        expect(
            requestedUrls.filter((url) => url.includes('/check-runs'))
        ).toHaveLength(1);
        expect(requestedUrls.some((url) => url.endsWith('/status'))).toBe(
            false
        );
    });

    it('requests canonical detail once and combined status only after empty checks', async () => {
        const { requestedUrls } = await runScenario({
            checks: { body: { check_runs: [] } },
        });
        const targetPrUrl = prUrl(40);

        expect(requestedUrls.filter((url) => url === targetPrUrl)).toHaveLength(
            1
        );
        expect(
            requestedUrls.filter((url) => url.includes('/check-runs'))
        ).toHaveLength(1);
        expect(
            requestedUrls.filter((url) => url.endsWith('/status'))
        ).toHaveLength(1);
    });

    it.each([
        {
            label: 'a failed check run',
            checks: [
                { status: 'completed', conclusion: 'failure' },
                { status: 'completed', conclusion: 'success' },
            ],
            expected: 'failing',
        },
        {
            label: 'a timed-out check run',
            checks: [{ status: 'completed', conclusion: 'timed_out' }],
            expected: 'failing',
        },
        {
            label: 'all successful completed checks',
            checks: [
                { status: 'completed', conclusion: 'success' },
                { status: 'completed', conclusion: 'success' },
            ],
            expected: 'passing',
        },
        {
            label: 'an incomplete check run',
            checks: [
                { status: 'in_progress', conclusion: null },
                { status: 'completed', conclusion: 'success' },
            ],
            expected: 'pending',
        },
    ])('reduces $label to $expected', async ({ checks, expected }) => {
        const { pullRequest } = await runScenario({
            checks: { body: { check_runs: checks } },
        });

        expect(pullRequest.ci_status).toBe(expected);
    });

    it.each([
        { state: 'success', expected: 'passing' },
        { state: 'failure', expected: 'failing' },
        { state: 'error', expected: 'failing' },
        { state: 'pending', expected: 'pending' },
        { state: 'unknown', expected: 'pending' },
    ])(
        'uses combined status $state when there are no check runs',
        async ({ state, expected }) => {
            const { pullRequest, requestedUrls } = await runScenario({
                checks: { body: { check_runs: [] } },
                combinedStatus: { body: { state } },
            });

            expect(pullRequest.ci_status).toBe(expected);
            expect(requestedUrls.some((url) => url.endsWith('/status'))).toBe(
                true
            );
        }
    );

    it('returns pending when canonical detail lacks optional CI coordinates', async () => {
        const { pullRequest, requestedUrls } = await runScenario({
            canonicalDetail: {
                body: prDetail(40, { head: undefined }),
            },
        });

        expect(pullRequest.ci_status).toBe('pending');
        expect(requestedUrls.some((url) => url.includes('/check-runs'))).toBe(
            false
        );
    });

    it('returns pending when the check-run request fails', async () => {
        const { pullRequest, rateLimit } = await runScenario({
            checks: { body: { message: 'server error' }, status: 502 },
        });

        expect(pullRequest.ci_status).toBe('pending');
        expect(rateLimit).toBeUndefined();
    });

    it('keeps CI pending and propagates a check-run rate limit', async () => {
        vi.useFakeTimers();
        vi.setSystemTime('2030-06-07T08:09:10.000Z');

        const { pullRequest, rateLimit } = await runScenario({
            checks: {
                body: { message: 'API rate limit exceeded' },
                status: 403,
                headers: {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': String(
                        new Date('2030-06-07T08:11:10.000Z').getTime() / 1000
                    ),
                    'x-ratelimit-resource': 'core',
                },
            },
        });

        expect(pullRequest.ci_status).toBe('pending');
        expect(rateLimit).toEqual({
            classification: 'primary',
            nextAllowedAt: new Date('2030-06-07T08:11:10.000Z').getTime(),
            deadlineSource: 'reset',
            resource: 'core',
        });
    });

    it('keeps CI pending and propagates a combined-status rate limit', async () => {
        vi.useFakeTimers();
        vi.setSystemTime('2030-06-07T08:09:10.000Z');

        const { pullRequest, rateLimit } = await runScenario({
            checks: { body: { check_runs: [] } },
            combinedStatus: {
                body: { message: 'secondary rate limit' },
                status: 429,
                headers: { 'retry-after': '45' },
            },
        });

        expect(pullRequest.ci_status).toBe('pending');
        expect(rateLimit?.nextAllowedAt).toBe(
            new Date('2030-06-07T08:09:55.000Z').getTime()
        );
        expect(rateLimit?.classification).toBe('secondary');
    });

    it('returns pending when a CI fetch rejects', async () => {
        const { pullRequest } = await runScenario({
            checks: new TypeError('check network failure'),
        });

        expect(pullRequest.ci_status).toBe('pending');
        expect(console.error).toHaveBeenCalledWith(
            'Error fetching CI status:',
            expect.any(TypeError)
        );
    });
});

describe('fetchPullRequests optional rate-limit aggregation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime('2030-06-07T08:09:10.000Z');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('selects the latest cooldown while completing every PR work unit', async () => {
        const requestedDetails: number[] = [];
        const reset = new Date('2030-06-07T08:14:10.000Z').getTime();

        installFetch((url) => {
            if (url.startsWith('https://api.github.com/search/issues?')) {
                return searchResponse([searchItem(1), searchItem(2)]);
            }
            if (url === prUrl(1) || url === prUrl(2)) {
                const number = url === prUrl(1) ? 1 : 2;
                requestedDetails.push(number);
                return jsonResponse(prDetail(number));
            }
            if (url === `${prUrl(1)}/reviews`) {
                return jsonResponse({ message: 'secondary rate limit' }, 429, {
                    'retry-after': '60',
                });
            }
            if (url === `${prUrl(2)}/reviews`) return jsonResponse([]);
            if (
                url.includes('/repo-1/commits/') &&
                url.endsWith('/check-runs')
            ) {
                return jsonResponse({ check_runs: [] });
            }
            if (url.includes('/repo-1/commits/') && url.endsWith('/status')) {
                return jsonResponse({ state: 'success' });
            }
            if (
                url.includes('/repo-2/commits/') &&
                url.endsWith('/check-runs')
            ) {
                return jsonResponse(
                    { message: 'API rate limit exceeded' },
                    403,
                    {
                        'x-ratelimit-remaining': '0',
                        'x-ratelimit-reset': String(reset / 1000),
                        'x-ratelimit-resource': 'core',
                    }
                );
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await fetchPullRequests(
            TOKEN,
            USER,
            'is:pr org:acme',
            createNotificationMock()
        );

        expect(result.status).toBe('success');
        if (result.status === 'failure') throw new Error('Expected success');
        expect(result.pullRequests.map(({ id }) => id)).toEqual([1, 2]);
        expect(requestedDetails).toEqual([1, 2]);
        expect(result.rateLimit).toEqual({
            classification: 'primary',
            nextAllowedAt: reset,
            deadlineSource: 'reset',
            resource: 'core',
        });
    });
});
