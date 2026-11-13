import { createElement } from 'react';
import { PullRequestList } from '../../src/components/PullRequestList';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
    activityTimestamp,
    groupPullRequests,
    repositoryIdentity,
    repositoryNameFromUrl,
    validatedRepositoryName,
} from '../../src/utils/prGrouping';
import {
    applyGroupingMutation,
    MAX_COLLAPSED_REPOSITORIES,
    normalizeGroupingPreferences,
} from '../../src/utils/groupingPreferences';
import { RepositoryGroupedList } from '../../src/components/RepositoryGroupedList';
import { GroupingControls } from '../../src/components/GroupingControls';
import type { PullRequest } from '../../src/types';

const pr = (
    id: number,
    fullName = 'Acme/API',
    updated_at: string | undefined = '2026-11-01T12:00:00Z'
): PullRequest => ({
    id,
    repository: { name: fullName.split('/')[1]!, full_name: fullName },
    html_url: `https://github.com/${fullName}/pull/${id}`,
    title: `PR ${id}`,
    created_at: '2020-01-01T00:00:00Z',
    updated_at,
    state: 'open',
    draft: false,
    requested_reviewers: [],
});

describe('repository identity and activity', () => {
    it('uses the canonical base identity and preserves display casing', () => {
        expect(
            repositoryIdentity({
                ...pr(1),
                base: {
                    repo: {
                        name: 'fork',
                        url: 'https://api.github.com/repos/fork/api',
                    },
                },
            })
        ).toEqual({ key: 'acme/api', name: 'Acme/API', persistable: true });
        expect(
            repositoryIdentity({ ...pr(1), repository: { name: 'API' } }).key
        ).toBe('acme/api');
        expect(repositoryIdentity(pr(2, 'Other/API')).key).toBe('other/api');
    });
    it.each([
        'http://github.com/acme/api/pull/1',
        'https://evil.test/acme/api/pull/1',
        'https://github.com/acme/api/issues/1',
        'https://user@github.com/acme/api/pull/1',
        'https://github.com/acme/api/pull/0',
        'https://github.com/acme/api/pull/1?x=1',
        'https://github.com/acme%2fother/api/pull/1',
        'bad',
    ])('rejects non-canonical legacy URL %s', (url) =>
        expect(repositoryNameFromUrl(url)).toBeUndefined()
    );
    it.each([
        'owner',
        'owner/repo/extra',
        '../repo',
        'owner/..',
        'owner/repo name',
        'owner/<script>',
    ])('rejects malformed identity %s', (name) =>
        expect(validatedRepositoryName(name)).toBeUndefined()
    );
    it('never hides or combines PRs whose identity is unavailable', () => {
        const invalid = [1, 2].map((id) => ({
            ...pr(id),
            repository: { name: 'api' },
            html_url: 'bad',
        }));
        const groups = groupPullRequests(invalid);
        expect(groups.map((group) => group.key)).toEqual([
            'unavailable:1',
            'unavailable:2',
        ]);
        expect(
            groups.every(
                (group) => !group.persistable && group.pullRequests.length === 1
            )
        ).toBe(true);
    });
    it.each([
        undefined,
        '',
        '2026-11-01',
        'yesterday',
        '2026-02-30T12:00:00Z',
        '2026-11-01T25:00:00Z',
    ])('rejects invalid activity %s', (value) =>
        expect(activityTimestamp(value)).toBeUndefined()
    );
    it('groups case-insensitively, counts matches, and retains supplied card sort order', () => {
        const input = [pr(3), pr(2, 'Other/API'), pr(1, 'acme/api')];
        const copy = structuredClone(input);
        const groups = groupPullRequests(input);
        expect(
            groups.map((group) => [
                group.key,
                group.pullRequests.map((item) => item.id),
            ])
        ).toEqual([
            ['acme/api', [3, 1]],
            ['other/api', [2]],
        ]);
        expect(input).toEqual(copy);
        expect(groupPullRequests([])).toEqual([]);
    });
    it('orders complete groups by their maximum update, with lexical ties and incomplete groups last alphabetically', () => {
        const missing = { ...pr(9, 'aaa/missing'), updated_at: undefined };
        const input = [
            missing,
            pr(1, 'b/old'),
            pr(2, 'a/new', '2026-11-02T00:00:00Z'),
            pr(3, 'b/old', '2026-11-03T00:00:00Z'),
            pr(4, 'c/tied', '2026-11-03T00:00:00Z'),
            { ...pr(5, 'a/new'), updated_at: undefined },
            { ...pr(6, 'zzz/missing'), updated_at: 'bad' },
        ];
        expect(groupPullRequests(input).map((group) => group.key)).toEqual([
            'b/old',
            'c/tied',
            'a/new',
            'aaa/missing',
            'zzz/missing',
        ]);
        expect(
            groupPullRequests([
                pr(1, 'a/repo', '2000-01-01T00:00:00Z'),
                {
                    ...pr(2, 'b/repo'),
                    created_at: '2099-01-01T00:00:00Z',
                    updated_at: undefined,
                },
            ])[0].key
        ).toBe('a/repo');
    });
    it('preserves each supplied ordering without sorting cards again', () => {
        for (const order of [
            [3, 2, 1],
            [1, 2, 3],
            [2, 3, 1],
            [2, 1, 3],
        ])
            expect(
                groupPullRequests(
                    order.map((id) => pr(id))
                )[0].pullRequests.map((item) => item.id)
            ).toEqual(order);
    });
});

describe('bounded grouping preferences', () => {
    it('keeps targeted choices when a bulk collapse must evict stale names', () => {
        const preferences = {
            mode: 'repository' as const,
            collapsedRepositories: Array.from(
                { length: MAX_COLLAPSED_REPOSITORIES },
                (_, i) => `acme/repo-${i}`
            ),
        };
        const next = applyGroupingMutation(preferences, {
            kind: 'set-repositories-collapsed',
            repositories: ['acme/repo-0', 'new/repo'],
            collapsed: true,
        });
        expect(next.collapsedRepositories).toHaveLength(
            MAX_COLLAPSED_REPOSITORIES
        );
        expect(next.collapsedRepositories).toContain('acme/repo-0');
        expect(next.collapsedRepositories).toContain('new/repo');
        expect(next.collapsedRepositories).not.toContain('acme/repo-1');
    });
    it.each([
        undefined,
        null,
        'bad',
        {},
        { mode: 'invalid', collapsedRepositories: 123 },
    ])('defaults invalid/missing preferences safely', (value) =>
        expect(normalizeGroupingPreferences(value)).toEqual({
            mode: 'none',
            collapsedRepositories: [],
        })
    );
    it('validates, deduplicates and normalises names, retaining valid choices in legacy data', () => {
        expect(
            normalizeGroupingPreferences({
                mode: 'repository',
                collapsedRepositories: [
                    'Acme/API',
                    null,
                    'bad',
                    'acme/api',
                    'Other/API',
                ],
            })
        ).toEqual({
            mode: 'repository',
            collapsedRepositories: ['acme/api', 'other/api'],
        });
    });
    it('retains only bounded newest choices and never resets collapse state when mode changes', () => {
        const names = Array.from(
            { length: MAX_COLLAPSED_REPOSITORIES + 1 },
            (_, i) => `acme/repo-${i}`
        );
        const preferences = normalizeGroupingPreferences({
            mode: 'repository',
            collapsedRepositories: names,
        });
        expect(preferences.collapsedRepositories).toEqual(names.slice(1));
        expect(
            applyGroupingMutation(preferences, {
                kind: 'set-grouping-mode',
                mode: 'none',
            }).collapsedRepositories
        ).toEqual(names.slice(1));
        expect(
            applyGroupingMutation(preferences, {
                kind: 'set-repositories-collapsed',
                repositories: ['new/repo'],
                collapsed: true,
            }).collapsedRepositories
        ).toEqual([...names.slice(2), 'new/repo']);
    });
});

describe('grouping presentation', () => {
    const props = {
        groups: groupPullRequests([pr(1), pr(2)]),
        collapsedRepositories: new Set(['acme/api']),
        searchActive: false,
        onToggle: () => {},
        onToggleHide: () => {},
    };
    it('exposes total counts and disclosure state without mounting collapsed links', () => {
        const html = renderToStaticMarkup(
            createElement(RepositoryGroupedList, props)
        );
        expect(html).toContain('Acme/API');
        expect(html).toContain('title="Acme/API"');
        expect(html).toContain('2');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('hidden=""');
        expect(html).not.toContain('pr-card-link');
    });
    it('temporarily expands all search matches without changing saved preferences', () => {
        const html = renderToStaticMarkup(
            createElement(RepositoryGroupedList, {
                ...props,
                searchActive: true,
            })
        );
        expect(html).toContain('aria-expanded="true"');
        expect(html).toContain('aria-disabled="true"');
        expect(html.match(/class="pr-card-link/g)).toHaveLength(2);
        expect(props.collapsedRepositories).toEqual(new Set(['acme/api']));
    });
    it('labels the native mode control and explains search-time disabled bulk controls', () => {
        const html = renderToStaticMarkup(
            createElement(GroupingControls, {
                mode: 'repository',
                onModeChange: () => {},
                prCount: 2,
                repositoryCount: 1,
                searchActive: true,
                onExpandAll: () => {},
                onCollapseAll: () => {},
            })
        );
        expect(html).toContain('>View</label>');
        expect(html).toContain('<option value="none">All PRs</option>');
        expect(html).toContain(
            '<option value="repository" selected="">By repository</option>'
        );
        expect(html).toContain('name="pr-grouping"');
        expect(html).toContain('2 PRs in 1 repository');
        expect(html.match(/disabled=""/g)).toHaveLength(2);
        expect(html).toContain('Clear search to collapse them');
    });
    it('shows only the PR count and no bulk actions in the flat view', () => {
        const html = renderToStaticMarkup(
            createElement(GroupingControls, {
                mode: 'none',
                onModeChange: () => {},
                prCount: 1,
                repositoryCount: 1,
                searchActive: false,
                onExpandAll: () => {},
                onCollapseAll: () => {},
            })
        );
        expect(html).toContain('1 PR');
        expect(html).not.toContain('in 1 repository');
        expect(html).not.toContain('Expand all');
        expect(html).not.toContain('Collapse all');
    });
    it('keeps the exact title in native tooltips and visible heading text', () => {
        const html = renderToStaticMarkup(
            createElement(PullRequestList, {
                pullRequests: [
                    {
                        ...pr(1),
                        title: '  Fix "quotes" & <markup> — exact title  ',
                        draft: true,
                    },
                ],
                onToggleHide: () => {},
            })
        );
        expect(html).toContain(
            'title="  Fix &quot;quotes&quot; &amp; &lt;markup&gt; — exact title  "'
        );
        expect(html).toContain(
            '>  Fix &quot;quotes&quot; &amp; &lt;markup&gt; — exact title  <span'
        );
        expect(html).not.toContain('exact title  Draft"');
    });
    it.each([
        {
            name: 'canonical',
            repository: { name: 'API', full_name: 'Canonical/API' },
            url: 'https://github.com/legacy/api/pull/1',
            expected: 'Canonical/API',
        },
        {
            name: 'legacy URL',
            repository: { name: 'API' },
            url: 'https://github.com/Legacy/API/pull/1',
            expected: 'Legacy/API',
        },
        {
            name: 'invalid canonical with valid fallback',
            repository: { name: 'API', full_name: 'invalid' },
            url: 'https://github.com/Legacy/API/pull/1',
            expected: 'Legacy/API',
        },
    ])(
        'exposes the $name identity on hover and as the card link description',
        ({ repository, url, expected }) => {
            const html = renderToStaticMarkup(
                createElement(PullRequestList, {
                    pullRequests: [{ ...pr(1), repository, html_url: url }],
                    onToggleHide: () => {},
                })
            );
            expect(html).toContain(`title="${expected}"`);
            expect(html).toContain(`aria-description="${expected}"`);
            expect(html).toMatch(/title="[^"]+">API<\/span>/);
        }
    );
    it('does not invent a full repository tooltip or description for unavailable identities', () => {
        const pullRequests = [
            {
                ...pr(1),
                repository: { name: 'API' },
                html_url: 'https://example.com/acme/api/pull/1',
            },
        ];
        const html = renderToStaticMarkup(
            createElement(PullRequestList, {
                pullRequests,
                onToggleHide: () => {},
            })
        );
        expect(html).not.toContain('aria-description');
        expect(html).not.toContain('title="Acme/API"');
        expect(html).toMatch(/class="[^"]*popup-repo-badge[^"]*">API<\/span>/);
        const grouped = renderToStaticMarkup(
            createElement(RepositoryGroupedList, {
                ...props,
                groups: groupPullRequests(pullRequests),
            })
        );
        expect(grouped).toContain('Repository unavailable');
        expect(grouped).not.toContain('title="Repository unavailable"');
    });
});
