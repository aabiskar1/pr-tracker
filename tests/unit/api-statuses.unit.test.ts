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
};

type Scenario = {
    reviews?: EndpointResult | Error;
    ciDetail?: EndpointResult | Error;
    checks?: EndpointResult | Error;
    combinedStatus?: EndpointResult | Error;
};

const endpointResponse = (
    result: EndpointResult | Error | undefined,
    defaultBody: unknown
): Response => {
    if (result instanceof Error) throw result;
    return jsonResponse(result?.body ?? defaultBody, result?.status);
};

const runScenario = async (scenario: Scenario = {}) => {
    const targetPrUrl = prUrl(40);
    const requestedUrls: string[] = [];
    let directPrRequests = 0;

    installFetch((url) => {
        requestedUrls.push(url);
        if (url.startsWith('https://api.github.com/search/issues?')) {
            return jsonResponse({ items: [searchItem(40)] });
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
            directPrRequests += 1;
            if (directPrRequests === 1) {
                return jsonResponse(prDetail(40));
            }
            return endpointResponse(scenario.ciDetail, prDetail(40));
        }
        throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await fetchPullRequests(
        TOKEN,
        USER,
        'is:pr repo:acme/repo-40',
        createNotificationMock()
    );

    expect(result).toHaveLength(1);
    return {
        pullRequest: result[0],
        requestedUrls,
    };
};

describe('fetchPullRequests review-status reduction', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
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
        const { pullRequest } = await runScenario({
            reviews: { body: { message: 'server error' }, status: 500 },
        });

        expect(pullRequest.review_status).toBe('pending');
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
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
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

    it('returns pending when the CI PR detail request fails', async () => {
        const { pullRequest, requestedUrls } = await runScenario({
            ciDetail: { body: { message: 'server error' }, status: 500 },
        });

        expect(pullRequest.ci_status).toBe('pending');
        expect(requestedUrls.some((url) => url.includes('/check-runs'))).toBe(
            false
        );
    });

    it('returns pending when the check-run request fails', async () => {
        const { pullRequest } = await runScenario({
            checks: { body: { message: 'server error' }, status: 502 },
        });

        expect(pullRequest.ci_status).toBe('pending');
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
