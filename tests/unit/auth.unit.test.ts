import browser from 'webextension-polyfill';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock,
} from 'vitest';
import { useAuth } from '../../src/hooks/useAuth';
import { persistGitHubRateLimitCooldown } from '../../src/background/githubRateLimit';
import {
    clearSecureStorage,
    encryptToken,
    hasEncryptionSetup,
    hasStoredToken,
    validatePassword,
} from '../../src/services/secureStorage';

const hookHarness = vi.hoisted(() => ({
    stateIndex: 0,
    values: [] as unknown[],
    setters: [] as Mock[],
    effects: [] as Array<() => void>,
}));

vi.mock('react', () => ({
    useState: vi.fn((initialValue: unknown) => {
        const index = hookHarness.stateIndex;
        hookHarness.stateIndex += 1;
        const setter = vi.fn();
        hookHarness.setters[index] = setter;
        const value =
            index in hookHarness.values
                ? hookHarness.values[index]
                : initialValue;
        return [value, setter];
    }),
    useEffect: vi.fn((effect: () => void) => {
        hookHarness.effects.push(effect);
    }),
}));

vi.mock('webextension-polyfill', () => ({
    default: {
        runtime: {
            sendMessage: vi.fn(),
        },
    },
}));

vi.mock('../../src/services/secureStorage', () => ({
    encryptToken: vi.fn(),
    validatePassword: vi.fn(),
    hasStoredToken: vi.fn(),
    hasEncryptionSetup: vi.fn(),
    clearSecureStorage: vi.fn(),
}));

vi.mock('../../src/background/githubRateLimit', () => ({
    persistGitHubRateLimitCooldown: vi.fn(),
}));

const TOKEN = 'ghp_sanitized_token';
const PASSWORD = 'password123';

const formEvent = () => ({
    preventDefault: vi.fn(),
});

const AuthHookHarness = () => useAuth();

const renderAuth = (stateValues: Record<number, unknown> = {}) => {
    hookHarness.stateIndex = 0;
    hookHarness.values = [];
    for (const [index, value] of Object.entries(stateValues)) {
        hookHarness.values[Number(index)] = value;
    }
    return AuthHookHarness();
};

const scopedResponse = (scopes: string | null, body: unknown = {}) => {
    const headers = new Headers();
    if (scopes !== null) headers.set('x-oauth-scopes', scopes);
    const json = vi.fn(async () => body);
    return {
        response: {
            ok: true,
            status: 200,
            headers,
            json,
        } as unknown as Response,
        json,
    };
};

const errorResponse = (
    status: number,
    body: unknown = {},
    headers: HeadersInit = {}
) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    });

describe('useAuth token validation and state transitions', () => {
    beforeEach(() => {
        hookHarness.stateIndex = 0;
        hookHarness.values = [];
        hookHarness.setters = [];
        hookHarness.effects = [];
        vi.clearAllMocks();
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
            hasRememberedPassword: false,
        });
        vi.mocked(hasEncryptionSetup).mockResolvedValue(false);
        vi.mocked(hasStoredToken).mockResolvedValue(false);
        vi.mocked(encryptToken).mockResolvedValue(undefined);
        vi.mocked(validatePassword).mockResolvedValue(false);
        vi.mocked(clearSecureStorage).mockResolvedValue(undefined);
        vi.mocked(persistGitHubRateLimitCooldown).mockResolvedValue(undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(['repo', 'gist, repo, read:user', '  gist ,  repo  , workflow '])(
        'accepts the required repo scope from realistic header value %j',
        async (scopes) => {
            const user = {
                login: 'octo-user',
                avatar_url: 'https://avatars.example/octo-user.png',
            };
            const { response, json } = scopedResponse(scopes, user);
            const fetchMock = vi.fn(async () => response);
            vi.stubGlobal('fetch', fetchMock);
            const auth = renderAuth({ 0: TOKEN });

            const event = formEvent();
            await auth.handleTokenSubmit(event);

            expect(event.preventDefault).toHaveBeenCalledOnce();
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api.github.com/user',
                {
                    headers: {
                        Authorization: `token ${TOKEN}`,
                        Accept: 'application/vnd.github.v3+json',
                    },
                }
            );
            expect(hookHarness.setters[4]).toHaveBeenCalledWith(
                'password-setup'
            );
            expect(hookHarness.setters[5].mock.calls).toEqual([
                [true],
                [false],
            ]);
            expect(hookHarness.setters[6]).toHaveBeenCalledWith('');
            expect(json).not.toHaveBeenCalled();
        }
    );

    it.each([
        { label: 'missing header', scopes: null },
        { label: 'unrelated scopes', scopes: 'gist, read:user' },
        { label: 'similar non-matching scope', scopes: 'repo:status' },
    ])('rejects a token with $label', async ({ scopes }) => {
        const { response } = scopedResponse(scopes);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => response)
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        expect(hookHarness.setters[6]).toHaveBeenCalledWith(
            'Token needs "repo" scope. Please generate a new token with repo access.'
        );
        expect(hookHarness.setters[4]).not.toHaveBeenCalledWith(
            'password-setup'
        );
        expect(hookHarness.setters[5]).toHaveBeenLastCalledWith(false);
    });

    it('reports a 401 response as an invalid token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => errorResponse(401))
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        expect(hookHarness.setters[6]).toHaveBeenCalledWith(
            'Invalid GitHub token. Please check the token and try again.'
        );
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
        expect(persistGitHubRateLimitCooldown).not.toHaveBeenCalled();
    });

    it('reports and persists a primary 403 rate limit without invalidating the token', async () => {
        const now = new Date('2030-06-07T08:09:10.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const reset = now.getTime() + 120_000;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                errorResponse(
                    403,
                    { message: 'API rate limit exceeded' },
                    {
                        'x-ratelimit-remaining': '0',
                        'x-ratelimit-reset': String(reset / 1000),
                        'x-ratelimit-resource': 'core',
                    }
                )
            )
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        const message = hookHarness.setters[6].mock.calls.at(-1)?.[0];
        expect(message).toContain('GitHub is rate limiting requests');
        expect(message).toContain('Please try again after');
        expect(message).not.toContain('Invalid');
        expect(persistGitHubRateLimitCooldown).toHaveBeenCalledWith({
            classification: 'primary',
            nextAllowedAt: reset,
            deadlineSource: 'reset',
            resource: 'core',
        });
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
    });

    it('uses shared Retry-After classification for a secondary limit', async () => {
        const now = new Date('2030-06-07T08:09:10.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                errorResponse(
                    403,
                    {
                        message: 'You have exceeded a secondary rate limit.',
                    },
                    { 'retry-after': '90' }
                )
            )
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        const message = hookHarness.setters[6].mock.calls.at(-1)?.[0];
        expect(message).toContain('GitHub is rate limiting requests');
        expect(message).not.toContain('Invalid');
        expect(persistGitHubRateLimitCooldown).toHaveBeenCalledWith({
            classification: 'secondary',
            nextAllowedAt: now.getTime() + 90_000,
            deadlineSource: 'retry-after',
        });
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
    });

    it('recognizes a 429 without reporting invalid credentials', async () => {
        const now = new Date('2030-06-07T08:09:10.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                errorResponse(429, { message: 'Too many requests' })
            )
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        const message = hookHarness.setters[6].mock.calls.at(-1)?.[0];
        expect(message).toContain('GitHub is rate limiting requests');
        expect(message).not.toContain('Invalid');
        expect(persistGitHubRateLimitCooldown).toHaveBeenCalledWith({
            classification: 'generic',
            nextAllowedAt: now.getTime() + 60_000,
            deadlineSource: 'secondary-fallback',
        });
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
    });

    it('reports an ordinary 403 as a permission failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                errorResponse(403, { message: 'Resource not accessible' })
            )
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        expect(hookHarness.setters[6]).toHaveBeenCalledWith(
            'GitHub rejected this request. Check that the token has the required permissions.'
        );
        expect(persistGitHubRateLimitCooldown).not.toHaveBeenCalled();
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
    });

    it('reports a GitHub server failure as temporary', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => errorResponse(503))
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        expect(hookHarness.setters[6]).toHaveBeenCalledWith(
            'GitHub is temporarily unavailable. Please try again.'
        );
        expect(persistGitHubRateLimitCooldown).not.toHaveBeenCalled();
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
    });

    it('surfaces a rejected network request and stays on the login state', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('network unavailable');
            })
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        expect(hookHarness.setters[6]).toHaveBeenCalledWith(
            'Unable to reach GitHub. Check your connection and try again.'
        );
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
        expect(hookHarness.setters[5]).toHaveBeenLastCalledWith(false);
    });

    it('preserves the current behavior of accepting a scoped response without parsing user details', async () => {
        const { response, json } = scopedResponse('repo', {
            unexpected: 'shape',
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => response)
        );
        const auth = renderAuth({ 0: TOKEN });

        await auth.handleTokenSubmit(formEvent());

        expect(json).not.toHaveBeenCalled();
        expect(hookHarness.setters[4]).toHaveBeenCalledWith('password-setup');
    });

    it('restores a remembered password and transitions directly to authenticated', async () => {
        vi.mocked(browser.runtime.sendMessage)
            .mockResolvedValueOnce({
                hasRememberedPassword: true,
                password: PASSWORD,
            })
            .mockResolvedValueOnce(true);
        renderAuth();

        hookHarness.effects[0]();

        await vi.waitFor(() => {
            expect(hookHarness.setters[1]).toHaveBeenCalledWith(PASSWORD);
            expect(hookHarness.setters[4]).toHaveBeenCalledWith(
                'authenticated'
            );
            expect(hookHarness.setters[5]).toHaveBeenCalledWith(false);
        });
        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
            type: 'CHECK_PRS',
            password: PASSWORD,
        });
        expect(hasEncryptionSetup).not.toHaveBeenCalled();
        expect(hasStoredToken).not.toHaveBeenCalled();
    });

    it.each([
        {
            label: 'no stored token',
            encryptionSetup: false,
            storedToken: false,
            expected: 'login-needed',
        },
        {
            label: 'token without encryption setup',
            encryptionSetup: false,
            storedToken: true,
            expected: 'password-setup',
        },
        {
            label: 'stored encrypted token',
            encryptionSetup: true,
            storedToken: true,
            expected: 'password-entry',
        },
    ])(
        'selects $expected during initialization for $label',
        async ({ encryptionSetup, storedToken, expected }) => {
            vi.mocked(hasEncryptionSetup).mockResolvedValue(encryptionSetup);
            vi.mocked(hasStoredToken).mockResolvedValue(storedToken);
            renderAuth();

            hookHarness.effects[0]();

            await vi.waitFor(() => {
                expect(hookHarness.setters[4]).toHaveBeenCalledWith(expected);
                expect(hookHarness.setters[5]).toHaveBeenCalledWith(false);
            });
        }
    );

    it('encrypts a new token, sets the session option, refreshes, and authenticates', async () => {
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue(true);
        const auth = renderAuth({
            0: TOKEN,
            1: PASSWORD,
            2: PASSWORD,
            3: true,
        });

        await auth.handlePasswordSetup(formEvent());

        expect(encryptToken).toHaveBeenCalledWith(TOKEN, PASSWORD);
        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
            type: 'SET_PASSWORD',
            password: PASSWORD,
            remember: true,
        });
        expect(hookHarness.setters[4]).toHaveBeenCalledWith('authenticated');
        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
            type: 'CHECK_PRS',
            password: PASSWORD,
        });
    });

    it.each([
        {
            password: 'short',
            confirmation: 'short',
            error: 'Password must be at least 8 characters long',
        },
        {
            password: PASSWORD,
            confirmation: 'different-password',
            error: 'Passwords do not match',
        },
    ])(
        'rejects invalid password setup: $error',
        async ({ password, confirmation, error }) => {
            const auth = renderAuth({
                0: TOKEN,
                1: password,
                2: confirmation,
            });

            await auth.handlePasswordSetup(formEvent());

            expect(hookHarness.setters[7]).toHaveBeenCalledWith(error);
            expect(encryptToken).not.toHaveBeenCalled();
        }
    );

    it('authenticates an existing encrypted token with the correct password', async () => {
        vi.mocked(validatePassword).mockResolvedValue(true);
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue(true);
        const auth = renderAuth({ 1: PASSWORD, 3: false });

        await auth.handlePasswordEntry(formEvent());

        expect(validatePassword).toHaveBeenCalledWith(PASSWORD);
        expect(browser.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
            type: 'SET_PASSWORD',
            password: PASSWORD,
            remember: false,
        });
        expect(hookHarness.setters[4]).toHaveBeenCalledWith('authenticated');
    });

    it('keeps the password-entry state for an incorrect password', async () => {
        vi.mocked(validatePassword).mockResolvedValue(false);
        const auth = renderAuth({ 1: 'incorrect password' });

        await auth.handlePasswordEntry(formEvent());

        expect(hookHarness.setters[7]).toHaveBeenCalledWith(
            'Incorrect password'
        );
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
    });

    it('signs out by clearing only the session and preserving encrypted storage', async () => {
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue(true);
        const auth = renderAuth({
            0: TOKEN,
            1: PASSWORD,
            2: PASSWORD,
            4: 'authenticated',
        });

        await auth.handleSignOut();

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'CLEAR_SESSION',
        });
        expect(clearSecureStorage).not.toHaveBeenCalled();
        expect(hookHarness.setters[0]).toHaveBeenCalledWith('');
        expect(hookHarness.setters[1]).toHaveBeenCalledWith('');
        expect(hookHarness.setters[2]).toHaveBeenCalledWith('');
        expect(hookHarness.setters[4]).toHaveBeenCalledWith('password-entry');
    });

    it('performs a confirmed reset by clearing secure storage and the session', async () => {
        vi.stubGlobal(
            'confirm',
            vi.fn(() => true)
        );
        vi.mocked(browser.runtime.sendMessage).mockResolvedValue(true);
        const auth = renderAuth({
            0: TOKEN,
            1: PASSWORD,
            2: PASSWORD,
            4: 'authenticated',
        });

        await auth.handleReset();

        expect(clearSecureStorage).toHaveBeenCalledOnce();
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'CLEAR_SESSION',
        });
        expect(hookHarness.setters[4]).toHaveBeenCalledWith('login-needed');
    });

    it('does not clear anything when reset confirmation is cancelled', async () => {
        vi.stubGlobal(
            'confirm',
            vi.fn(() => false)
        );
        const auth = renderAuth({ 4: 'password-entry' });

        await auth.handleReset();

        expect(clearSecureStorage).not.toHaveBeenCalled();
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
        expect(hookHarness.setters[4]).not.toHaveBeenCalled();
    });
});
