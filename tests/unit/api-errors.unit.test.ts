import browser from 'webextension-polyfill';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeHttpError, handleApiError } from '../../src/background/api';

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

type NotificationOptions = {
    type: 'basic';
    iconUrl: string;
    title: string;
    message: string;
};

type NotificationHandler = (
    id: string | undefined,
    options: NotificationOptions,
    forceShow?: boolean
) => Promise<void>;

const createNotificationMock = () =>
    vi.fn<NotificationHandler>(async () => undefined);

const response = (
    status: number,
    body = '',
    headers: HeadersInit = {}
): Response =>
    new Response(body, {
        status,
        headers,
    });

describe('analyzeHttpError', () => {
    it('classifies a 401 response as an authentication failure', async () => {
        await expect(analyzeHttpError(response(401))).resolves.toEqual({
            message:
                'Authentication failed (401). Your GitHub token may have been revoked or expired. Re-enter password or reset to provide a new token.',
            isRateLimit: false,
            isAuth: true,
        });
    });

    it('classifies an ordinary 403 response as forbidden', async () => {
        await expect(
            analyzeHttpError(
                response(403, 'Forbidden', {
                    'X-RateLimit-Remaining': '12',
                })
            )
        ).resolves.toEqual({
            message:
                'Access forbidden (403). Could be missing repo scope OR a temporary GitHub restriction. Try again later; if persistent, regenerate a token with repo scope.',
            isRateLimit: false,
            isAuth: false,
        });
    });

    it('classifies a 403 with no remaining requests as rate limited', async () => {
        const result = await analyzeHttpError(
            response(403, 'Forbidden', {
                'X-RateLimit-Remaining': '0',
            })
        );

        expect(result).toEqual({
            message:
                'GitHub API rate limit exceeded. Please wait before trying again.',
            isRateLimit: true,
            isAuth: false,
        });
    });

    it('classifies a 429 response as rate limited', async () => {
        const result = await analyzeHttpError(response(429));

        expect(result.isRateLimit).toBe(true);
        expect(result.isAuth).toBe(false);
    });

    it.each([
        'You have exceeded a secondary rate limit.',
        'Request blocked by abuse detection mechanism.',
    ])('classifies body wording as rate limited: %s', async (body) => {
        const result = await analyzeHttpError(response(403, body));

        expect(result.isRateLimit).toBe(true);
        expect(result.isAuth).toBe(false);
    });

    it('includes a rate-limit reset header without relying on local time formatting', async () => {
        const timeSpy = vi
            .spyOn(Date.prototype, 'toLocaleTimeString')
            .mockReturnValue('fixed reset time');

        const result = await analyzeHttpError(
            response(403, 'rate limit', {
                'X-RateLimit-Reset': '1893456000',
            })
        );

        expect(result.message).toBe(
            'GitHub API rate limit exceeded (resets at fixed reset time). Please wait before trying again.'
        );
        expect(timeSpy).toHaveBeenCalledOnce();
    });

    it('classifies server failures', async () => {
        await expect(analyzeHttpError(response(503))).resolves.toEqual({
            message:
                'GitHub servers are experiencing issues (503). Please try again later.',
            isRateLimit: false,
            isAuth: false,
        });
    });

    it('classifies ordinary client failures', async () => {
        await expect(analyzeHttpError(response(422))).resolves.toEqual({
            message:
                'Request failed with status 422. Please check your network connection and try again.',
            isRateLimit: false,
            isAuth: false,
        });
    });

    it('classifies an unexpected non-error status', async () => {
        await expect(analyzeHttpError(response(302))).resolves.toEqual({
            message: 'Unexpected error occurred (302). Please try again.',
            isRateLimit: false,
            isAuth: false,
        });
    });
});

describe('handleApiError', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports the classified authentication error and force-shows its notification', async () => {
        const createNotification = createNotificationMock();

        const result = await handleApiError(
            response(401),
            createNotification,
            'Authenticated user request'
        );

        expect(result).toEqual({
            message:
                'Authentication failed (401). Your GitHub token may have been revoked or expired. Re-enter password or reset to provide a new token.',
            isRateLimit: false,
            isAuth: true,
        });
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            {
                type: 'basic',
                iconUrl: 'icons/icon-128.png',
                title: 'PR Tracker Error',
                message: result.message,
            },
            true
        );
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message: result.message,
        });
        expect(console.error).toHaveBeenCalledWith(
            'Authenticated user request failed with status: 401',
            result
        );
    });

    it('reports a non-authentication failure without force-showing its notification', async () => {
        const createNotification = createNotificationMock();

        const result = await handleApiError(
            response(500),
            createNotification,
            'PR detail request'
        );

        expect(result).toEqual({
            message:
                'GitHub servers are experiencing issues (500). Please try again later.',
            isRateLimit: false,
            isAuth: false,
        });
        expect(createNotification).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({
                message: result.message,
            }),
            false
        );
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'SHOW_ERROR',
            message: result.message,
        });
    });
});
