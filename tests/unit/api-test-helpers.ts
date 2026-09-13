import { vi } from 'vitest';

export const TOKEN = 'sanitized-token';
export const USER = {
    login: 'octo-user',
    avatar_url: 'https://avatars.example/octo-user.png',
};

export type NotificationOptions = {
    type: 'basic';
    iconUrl: string;
    title: string;
    message: string;
};

export type NotificationHandler = (
    id: string | undefined,
    options: NotificationOptions,
    forceShow?: boolean
) => Promise<void>;

export const createNotificationMock = () =>
    vi.fn<NotificationHandler>(async () => undefined);

export const jsonResponse = (
    body: unknown,
    status = 200,
    headers: HeadersInit = {}
): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    });

export const prUrl = (number: number): string =>
    `https://api.github.com/repos/acme/repo-${number}/pulls/${number}`;

export const searchItem = (number: number) => ({
    id: number,
    pull_request: {
        url: prUrl(number),
    },
});

export const prDetail = (
    number: number,
    overrides: Record<string, unknown> = {}
) => ({
    id: number,
    title: `PR ${number}`,
    html_url: `https://github.com/acme/repo-${number}/pull/${number}`,
    state: 'open',
    draft: false,
    created_at: '2025-01-02T03:04:05.000Z',
    requested_reviewers: [
        {
            login: 'reviewer',
            avatar_url: 'https://avatars.example/reviewer.png',
        },
    ],
    user: {
        login: 'author',
        avatar_url: 'https://avatars.example/author.png',
    },
    head: {
        sha: `sha-${number}`,
    },
    base: {
        repo: {
            name: `repo-${number}`,
            url: `https://api.github.com/repos/acme/repo-${number}`,
        },
    },
    ...overrides,
});

type FetchHandler = (
    url: string,
    init?: RequestInit
) => Response | Promise<Response>;

const requestUrl = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
};

export const installFetch = (handler: FetchHandler) => {
    const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) =>
            handler(requestUrl(input), init)
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

export const queryFromSearchUrl = (url: string): string =>
    new URL(url).searchParams.get('q') ?? '';
