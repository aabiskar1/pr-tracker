# Repository grouping investigation

Investigation for PR #110; implementation proposal for PR #111. Reviewed against
`main` at `11efd457a52975b7406261064251ab140826df5d` (v1.0.23), on
13 November 2026. This document changes no application behaviour.

## Recommendation

Add an opt-in Repository mode beside the existing None mode. Put its controls in
a separate results row below search. Use independently expandable repository
headings and reuse the existing detailed PR lists inside them. Persist only the
mode and collapsed repository identities in encrypted app preferences. Derive
search expansion without writing preferences.

Order repositories by their newest matching PR's canonical `updated_at`, provided
PR #111 preserves that field through mapping and the conditional-detail cache.
The existing requests already return it, but today's persisted data does not.
Use alphabetical full repository identity when activity information is incomplete.
Do not label creation time as activity. Defer attention badges unless the narrow
“Review requested” definition below is agreed.

## Current UI and behaviour

The relevant boundaries are
[Dashboard](../../src/components/Dashboard.tsx),
[FilterBar](../../src/components/FilterBar.tsx),
[PullRequestList](../../src/components/PullRequestList.tsx),
[usePullRequests](../../src/hooks/usePullRequests.ts), and
[shared types](../../src/types.ts). The
[architecture](../architecture.md), [testing guide](../testing.md), and
[development guide](../development.md) describe the surrounding system.

- Dashboard renders the header, FilterBar, local search, then an empty message or
  one PullRequestList. It already receives the final `filteredPRs` array.
- The hook filters hidden, reviewed-only, draft/ready, creation-age, aggregate
  review status and CI status. An empty review/CI selection imposes no restriction.
  Reviewed means discovery history, not the aggregate review badge. Missing legacy
  discovery information is retained conservatively.
- Sorting runs before local search: Newest/Oldest use `created_at`; Most Reviewers
  (`urgent`) uses the number of requested reviewers; Most Stale puts unapproved
  PRs first, then uses oldest creation time. Preserve these rules within groups.
- Search is a case-insensitive substring match on title or `repository.name`.
  It is local, unpersisted and currently does not search the owner. The custom
  GitHub query is a different, saved control which changes discovery requests.
- Filter, sort, custom-query and notification changes use `UPDATE_APP_DATA` with
  validated operations. Reset Filters restores filters only; it does not reset
  sort, search or the custom query.
- Hiding is optimistic in the popup. Separately encrypted hidden IDs are the
  source of truth on reload; the background mutation also updates current and old
  snapshots. “Hidden” includes hidden cards alongside other matches, rather than
  selecting hidden cards exclusively.
- Cards include the repository badge, hide action, creation-age colour, wrapping
  title, separate CI/review badges, up to ten reviewer avatars with overflow,
  reviewer total, and author. Keep all of these. The existing hide button is
  nested inside the PR link; do not reproduce that structure in group headings.
  Any card interaction correction should have its own focused regression coverage.

### Size, scrolling and visual consistency

[Popup CSS](../../entrypoints/popup/style.css) fixes the PR-list document width at
750 CSS pixels for both engines and gives body/root a 600px minimum height.
[App CSS](../../src/App.css) also gives the dashboard a 600px minimum height.
These are not an independently scrolling 600px list or a responsive full-page
dashboard: the toolbar panel constrains the viewport and the document scrolls.
There is no per-card or per-repository scroll container. Header, filters and search
scroll away with the document.

The filter surface is approximately 105px high in existing visual assertions;
search is 40px. Adding grouping to the already busy filter/custom-query rows would
take space from the list. Keep the header and filter geometry intact and budget
one compact additional results row. Use the existing single document scroll area;
do not add nested scrolling or sticky headers in this iteration.

Horizontal overflow is hidden globally, so an absent scrollbar alone does not
prove that content fits. Check bounding boxes and `scrollWidth` for long names.
Existing flex wrapping, `min-w-0`, truncated repository badges, compact spacing,
engine-specific scrollbars and `.screen-prlist` sizing hooks must be preserved.
Native popup sizing must be checked separately from popup.html opened in a tab.
Browser panels resize and close independently of React; see the official
[Chrome action documentation](https://developer.chrome.com/docs/extensions/reference/api/action#popup)
and [Firefox popup documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Popups).

[Semantic tokens](../../src/styles/tokens.css) and
[production theme rules](../../src/theme.css) already provide light/dark surfaces,
focus tokens and compact production styling. Reuse Button, Badge and Input where
appropriate; native selects remain established practice. Do not introduce a
library, a theme provider, a second token source or a generic dashboard redesign.

## Confirmed product requirements

These requirements are fixed; subsequent recommendations do not replace them.

- Modes are None and Repository. None is the default for new and existing users
  until they explicitly change it. Save the mode across popup closure and browser
  restart. Returning to None restores existing flat-list behaviour.
- Group by full `owner/repo`, display that identity and the matching PR count,
  allow independent collapse, and provide Expand all and Collapse all. New
  repositories start expanded. Every matching PR in an expanded group is shown;
  there is no pagination or five-card cap.
- Retain detailed cards, filters, search, hiding and within-group sorting. Apply
  the existing visibility/search pipeline before grouping, exclude empty groups,
  and base counts on matching cards, including those concealed by collapse.
- Search temporarily expands matching groups. Clearing it restores saved states;
  search must never overwrite those states. Save ordinary collapse choices across
  popup closures and browser restarts.
- Prefer repository ordering by recent PR activity, subject to reliable evidence.
  Attention counts require an explicit meaning before implementation.

## Interaction and layout

```text
Existing header
Existing filters / sort / custom GitHub query
Search pull requests [________________________]
Group by [Repository v]   40 PRs in 8 repositories
[Expand all] [Collapse all]
v acme/api                 7 PRs
  [existing detailed card]
  [existing detailed card ... all 7]
> other-owner/api          3 PRs
v acme/web                 5 PRs
  [existing detailed cards ...]
```

This is a layout sketch, not a pixel specification. Let the summary and bulk
buttons share the selector row when they fit; wrap the bulk buttons onto a second
line when needed. In None mode show the selector and matching PR total, without
repository bulk actions. Do not put controls into the main header or a new menu.

Recommended details for PR #111:

- Use a visibly labelled native “Group by” select with None and Repository.
  Retain the chosen mode even when no results match.
- Make the repository header a full-width disclosure button, with a decorative
  chevron immediately before the full name and a textual `7 PRs` count. Wrap long
  identities with `overflow-wrap: anywhere`; keep the count from shrinking. Do not
  make the repository label a link nested within that button.
- Bulk actions affect the currently matching repository set, including groups
  already collapsed. Leave absent repositories' preferences alone. One click
  sends one mutation, not one mutation per repository. Repeated no-op actions
  should neither write nor move focus.
- While a non-empty local search is active, keep every matching group expanded.
  Make collapse actions unavailable with a visible explanation such as “Matching
  repositories are expanded while searching”. Keep headers navigable; use
  `aria-disabled` and suppress activation there. Bulk buttons may be disabled.
  Expand all is already satisfied. This avoids a search result becoming hidden
  again and makes the no-write rule straightforward.
- Use the same definition of non-empty search as the current hook (`length > 0`),
  including whitespace; do not silently change matching or trimming in PR #111.
  Preserve title/repository-name search initially. Owner search is a separate
  optional product decision below.
- Clearing search, changing filters or switching modes does not erase saved
  collapse choices. Empty results keep the existing “No pull requests found”
  message, no group headers, and no enabled bulk actions.

### Native disclosure versus controlled sections

`details`/`summary` is a viable, broadly supported option: built-in keyboard
activation, disclosure state and hidden content need little code. Use independent
details without a shared `name`; exclusivity violates the requirements. However,
programmatic `open` changes from hydration, search and bulk actions also generate
toggle events. Persisting every toggle would save temporary state. Keeping card
subtrees mounted also retains their React/DOM cost, and headings within summary
are not reliably exposed as headings to assistive technology.

Recommend React-controlled sections with a native Button inside each repository
heading, `aria-expanded`, stable `aria-controls`, and a persistent panel wrapper
whose card subtree is rendered only while expanded. This lets screen-reader
users navigate repository headings and ensures only explicit user actions save
state. Derive effective expansion during render:

```text
effectiveExpanded = searchActive || !collapsedRepositories.has(repositoryKey)
```

Use plain hidden panel wrappers when collapsed, and never leave concealed links
in the tab order. This intentionally does not support browser Find-in-page for
unmounted cards; the popup's search is the supported route to all matching data.
Do not add `hidden=until-found`, invoker commands or animated intrinsic heights
to solve a requirement already handled by local search.

Keep a sequential outline: PR Tracker as h1, repository headings as h2, existing
card titles as h3. The current Dashboard title is h2, so that small semantic update
also needs corresponding scoped theme selectors and test-selector updates,
preserving its appearance. No need to refactor cards into a new card component.
Avoid turning all 30 groups into separate named region landmarks.

## Repository identity and recent activity

[The canonical REST response](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
contains PR-level `updated_at` and `base.repo.full_name`. The base repository is
the target, including when the head comes from a fork. Those fields need no
additional request. Treat `updated_at` as GitHub's PR last-update timestamp, not
a promise that every CI transition, review event or repository-wide change moves
it. An exact event timeline would require a broader design and is unnecessary.

### What survives today

| Stage                                                           | Repository identity                                                       | Activity timestamp                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Canonical detail GET                                            | Base repository full name and URLs exist                                  | PR `updated_at` exists                             |
| `mapPullRequestDetail` in [api.ts](../../src/background/api.ts) | Keeps only `repository.name` and PR `html_url`; does not retain base repo | Keeps `created_at`, discards `updated_at`          |
| Detail-cache projection supplied by `api.ts`                    | Keeps base repo name/API URL and PR URL, omits full name                  | Keeps `created_at`, omits `updated_at`             |
| 304 revalidation                                                | Maps the stored projection again                                          | Cannot recover discarded fields                    |
| Encrypted AppData / popup                                       | Retains mapped PRs without a further projection                           | No activity field in the current PullRequest model |

[detailCache.ts](../../src/background/detailCache.ts) accepts a detail record,
but its caller deliberately supplies the reduced projection; inspecting the
cache schema alone would give the wrong conclusion. The cache's numeric
`updatedAt` is its record/write age, not PR activity. Neither `lastUpdated` nor
`lastSuccessfulRefreshAt` on AppData measures individual PR activity.

### Proposed identity and ordering

Add optional `repository.full_name` and optional `updated_at` to PullRequest so
v1.0.23 snapshots remain readable. Preserve validated values from canonical
details in both the mapper and cache projection. Use one pure identity helper:

1. Prefer a valid target `repository.full_name` from the mapped canonical detail.
2. For legacy data, parse an HTTPS `github.com/{owner}/{repo}/pull/{number}`
   `html_url` with URL, validating the path. Both owner and repository are already
   retained there. Do not use the head fork, bare `repository.name`, title or array
   position. Normalise comparison/storage keys to lowercase, retaining display
   casing separately.
3. If neither identity is usable, render the PR in an explicit “Repository
   unavailable” fallback with a per-PR key; do not combine unrelated bare names
   or persist that fallback as a real repository. It must remain searchable and
   readable rather than disappear.

A rename/transfer becomes a new identity and therefore starts expanded. Following
repositories across renames by numeric ID is outside this iteration.

For each group, take the maximum valid `updated_at` across its matching PRs,
independent of the selected card sort. Sort descending and break ties by
normalised full identity using a deterministic lexical comparison. Compute from
matching PRs so hidden or filtered-out activity cannot unexpectedly move groups.
Order can change after a successful refresh or changed search/filter; stable
repository/PR keys prevent remounts purely because their positions change.

Recommend **alphabetical ordering for the entire matching set if any matching PR
lacks a valid timestamp**, with a small “Repository order: Name (activity data
unavailable)” explanation. This avoids mixing incomparable known and unknown
recency. If timestamps are complete, describe the order as “Recently updated”.
Never substitute `created_at`, current time, cache age or the sort's first card.

For PR #111, bump the conditional-detail cache version to discard projections
that lack the new fields. Normal scheduled/manual detail requests will then get
full bodies and rebuild the cache; do not add a second GET, force a refresh on
mode selection, or introduce a retry. Legacy AppData uses the explicit fallback
until a successful refresh. An alternative is to invalidate only entries missing
the fields, but a version bump is simpler for this small bounded cache.

This is a proposed data-preservation change for #111, not a REST endpoint or
refresh-policy change in #110. Continue review and CI fetching even on a 304;
neither timestamps nor SHA establish freshness for those endpoints. Keep required
detail failure handling, cooldowns, cancellation and last-known-good snapshots.

## Attention indicators

Do not ship a generic “Needs attention” total. Authorship, failing CI, old age,
pending aggregate reviews and changes requested are different signals; the current
data cannot establish a single personal action queue.

Default discovery runs authored, `review-requested:LOGIN` and reviewed-by searches
and unions their sources before deduplication. Custom-query results deliberately
omit them. [GitHub search documentation](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-pull-request-review-status-and-reviewer)
distinguishes review requests from review history; indexing can lag current state.
[isReviewedOnly](../../src/utils/discoverySources.ts) is a visibility/notification
helper, not an attention classifier.

If approved, use the narrower label **“Review requested”**: the number of visible
open, non-draft PRs whose `discoverySources` contains `review-requested`, excluding
authored-source PRs. Count each PR once. It means a request found by the latest
successful default discovery, not a live assertion of outstanding work. Existing
Last checked remains relevant when cached data is displayed.

| Case                                                                     | Proposed treatment and reason                                                                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready, open, review-requested source                                     | Count once, even with multiple discovery sources or reviewers                                                                                |
| Draft with a review-requested source                                     | Exclude from actionable count; still include in total matching PRs                                                                           |
| Reviewed-only (approval, changes requested or comment-only review)       | Exclude; history is not an outstanding request                                                                                               |
| Reviewed plus review-requested                                           | Count if otherwise eligible: re-requesting review is possible                                                                                |
| Aggregate Approved or Changes badge plus review-requested                | Do not infer completion by this user from an aggregate; the source still governs                                                             |
| Pending review badge without review-requested source                     | Exclude; optional review failures also degrade to Pending                                                                                    |
| Authored, including contradictory authored plus review-requested sources | Exclude; do not suggest users review their own work                                                                                          |
| Requested reviewer avatars present                                       | Not sufficient: may refer to someone else; popup has no current-user identity in this model                                                  |
| Team requests                                                            | Do not infer team membership from avatars; no requested-team mapping is retained. Report only what the existing discovery source establishes |
| Custom query, missing legacy sources or empty sources                    | Unknown, not zero; do not infer from query text or badge status                                                                              |
| Closed PR from a custom query                                            | Never actionable under this definition                                                                                                       |

For the first version, suppress the attention badge for a group with any unknown
discovery metadata, and omit zero badges. This avoids presenting partial evidence
as a complete count. Total PR counts remain available for every group. Do not add
GitHub requests or expose reviewer identity merely to fill a badge. Notification
eligibility, toolbar badge totals and hidden-PR notification rules stay independent.
Implement this only after the product decision; otherwise ship total PR counts
alone in #111.

## Preference persistence proposal

Use the proposed small shape as an optional `AppPreferences.grouping` field:

```ts
type GroupingPreferences = {
    mode: 'none' | 'repository';
    collapsedRepositories: string[];
};
```

Absence means `{ mode: 'none', collapsedRepositories: [] }`. Saving only collapsed
identities naturally makes new repositories expanded. Switching to None preserves
the set for a later return to Repository. Keep grouping independent of Reset
Filters, local search, saved query and notifications.

Validation belongs at both the encrypted-data read/normalisation boundary and
the runtime mutation boundary. Existing `decryptAppData<T>` JSON parsing is not
runtime validation of T; [storageSchemas](../../src/services/storageSchemas.ts)
primarily validates envelopes. Use a focused shared grouping schema/normaliser,
not a rewrite of the entire legacy AppData schema:

- Missing/invalid mode becomes None. Invalid/non-array collapse data becomes an
  empty list; discard invalid entries, normalise casing and deduplicate valid
  full identities. A corrupt grouping field must not make PR data unreadable.
- Recommend a 1,000-identity cap and 256-character maximum per identity, with
  exactly one slash and validated owner/repository characters. These are grouping
  bounds, not GitHub result or UI limits. Verify the grammar against valid GitHub
  names when implementing. Mutations reject invalid/oversized input.
- Preserve absent repositories through temporary filters, search, custom queries
  and failed refreshes. Do not prune on each render. At the cap, retain the most
  recently explicitly collapsed entries and evict oldest stored choices; an
  evicted repository reopens by default. Array order is sufficient; no timestamps
  or background cleanup job are needed. Explain this rare limit on save if hit.
- This bounds grouping metadata, not the whole encrypted snapshot. The current
  numeric-byte-array encrypted envelope has overhead, so do not claim a precise
  quota guarantee from plaintext string lengths. Report storage failures and
  retain the last saved state.

Extend [appDataStore](../../src/background/appDataStore.ts)'s strict mutation union
with narrow operations for mode and setting a batch of repository collapsed
states. The background updates the latest set inside its existing serial queue,
preserving mode and unrelated preferences. Batch operations also avoid losing
independent rapid clicks through stale whole-object replacements. Do not send the
entire AppData or keep a second plaintext localStorage preference.

Only explicit user changes write. Derivation, hydration, search and refresh-driven
rendering do not. Compare normalised before/after state and use the existing
`shouldWrite` facility to skip no-ops. Optimistic UI must reconcile with the
acknowledged/storage state; on rejection, restore saved choices and display a
save error. Ensure queued actions do not get reset by an earlier storage reload.

### Lifecycle and account boundaries

| Event                                          | Current boundary and proposed grouping behaviour                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup close/reopen, browser/background restart | AppData survives in encrypted local extension storage. Reload grouping with other preferences; no module-global persistence                                                                                                                    |
| Sign Out / password unlock                     | Sign Out locks the session, retaining encrypted AppData/token. Retain grouping and restore on unlock; clear transient UI state while locked                                                                                                    |
| Full Reset                                     | Background invalidates the session, drains writes and clears encrypted AppData. Grouping disappears automatically; independent theme remains                                                                                                   |
| Same-account token replacement                 | `encryptToken` clears detail cache, not AppData preferences. Retain grouping when the same app-data envelope remains decryptable                                                                                                               |
| Different account                              | The supported path is Full Reset then new token setup; grouping resets with account data. AppData has no account/token scope field, unlike the detail cache. Do not claim automatic isolation for out-of-band credential replacement           |
| v1.0.23 upgrade/downgrade                      | Optional additive field gives old snapshots default None; existing spread-based mutations preserve unrelated fields. Do not require an eager migration write. Do not promise older releases preserve new fields across every possible workflow |

This proposal uses the existing single-account lifecycle without changing
authentication. If account switching without Full Reset becomes supported, an
account-scoped AppData design is required before reusing private repository names;
do not solve that by silently adding a new identity request for grouping.

## Findings from the selected UI guidance

Google Modern Web Guidance is installed. Read its actual SKILL.md and used its
documented temporary CLI runner, with skill version `2026_11_09-5bcc021b`:
searched `accessible disclosure sections`, then retrieved `accordion`, `html`,
`accessibility` and `search-hidden-content`. No project dependency/configuration
was installed or changed. The [official repository](https://github.com/GoogleChrome/modern-web-guidance/tree/4dd968349e54ca45a05dd5c818fb035c9054b022)
describes this search/retrieve workflow.

Neither Vercel skill is installed in the available local skill catalogues. Read
the official [Web Design Guidelines skill](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines/SKILL.md),
its required fresh [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md),
and the [React Best Practices skill](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/SKILL.md)
plus the individual rules linked below. These are an advisory source review, not
a claim that either missing skill ran locally. Sources were consulted on
13 November 2026; repository guidance links pin the reviewed revisions. Google
CLI guide content was retrieved separately and can evolve independently.

| Guidance and useful recommendation                                                                                                                                                            | Why it matters / current implementation                                                                             | Include in #111? / compatibility                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Google `accordion`: prefer native disclosure; use heading-wrapped buttons where section headings matter                                                                                       | A 20–30 repository outline benefits from heading navigation; existing cards already use headings and native buttons | Yes: controlled heading buttons are the guide's justified alternative. Independent expansion; no new library or shared details `name`   |
| Google `accessibility` / `html`: semantic controls, logical focus and labelled counts                                                                                                         | Existing Button has keyboard/focus treatment; grouped panels need state and focus restoration                       | Yes: use native buttons and select. No extra Enter/Space handlers, roving tabindex or arrow-key interception                            |
| Google `search-hidden-content`: hidden content and browser Find differ                                                                                                                        | Current local search operates on data. Unmounted panels cannot be found by browser Find                             | Apply the distinction, not `until-found`. Local search reveals matches in both engines without a new platform dependency                |
| Vercel Web Design: focus, labels, long-content handling and empty states                                                                                                                      | Shared controls already help; new headers need full identities and counts                                           | Yes; reuse tokens and test both themes, wrapping and focus. No new browser API                                                          |
| Vercel Web Design: avoid hiding focused controls; size images                                                                                                                                 | A collapsing group can remove a focused card; avatar CSS sizes already reserve space                                | Yes for group focus handling; explicit avatar dimensions are a small optional card follow-up, not a prerequisite                        |
| Vercel Web Design: long-list optimisation and state in URLs                                                                                                                                   | Detailed lists and sensitive persistent preferences need care; URLs do not supply encrypted preference persistence  | Measure lists first. Decline automatic “over 50” virtualisation and URL-synchronised private repository state                           |
| React [derive during render](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/rules/rerender-derived-state-no-effect.md) | Existing filteredPRs uses useMemo; group counts/search expansion should not become duplicated state                 | Yes: pure derived groups; memoise the collection when dependencies are stable. Ordinary React, same in both engines                     |
| React [interaction in handlers](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/rules/rerender-move-effect-to-event.md) | Existing preference actions already send mutations from handlers                                                    | Yes: no persistence effect observing effective expansion, which would save search overrides                                             |
| React [Set/Map lookups](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/rules/js-set-map-lookups.md)                    | Existing code already uses these in several paths                                                                   | Yes: one grouping pass, Set for collapse membership, group maxima in that pass; no repeated scanning per header                         |
| React [bounded storage](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/rules/client-localstorage-schema.md)            | Existing app data is encrypted extension storage, not web localStorage                                              | Adapt validation and minimisation only; retain current persistence/encryption boundary                                                  |
| React [content visibility](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/rules/rendering-content-visibility.md)       | Current cards vary in height; hidden groups can avoid mounting them                                                 | Future measured option. It retains DOM and needs sizing/focus checks; the article's 1,000-message example is not a PR Tracker benchmark |

Do not copy Next.js server-component, SSR/hydration, SWR or server-cache advice
into this client-only extension. Do not copy declarative command examples without
checking browser versions. Google's retrieved guide reports Firefox lacks
`interpolate-size`; height animation is unnecessary here. Plain React click
handlers, native controls and immediate expansion work in Chrome MV3 and Firefox
MV2 with existing extension CSP and permissions. Modern guidance also differs on
some fallback choices for `until-found`; avoiding that feature removes the issue.

## Proposed component and data flow

```text
Existing REST -> validated mapped PRs -> encrypted AppData
                    |                            |
          detail ETag projection                v
                                       usePullRequests
                              hidden IDs + filter/sort/search
                                                 |
                                    existing filteredPRs
                                                 v
                     Dashboard: GroupingControls + result summary
                           | None                 | Repository
                           v                      v
                    PullRequestList       pure groupPullRequests
                                              / orderGroups
                                                 |
                                      RepositoryGroupedList
                                   heading Button + panel wrapper
                                                 |
                                     existing PullRequestList

Explicit mode/collapse action -> usePullRequests handler
    -> UPDATE_APP_DATA -> validated, serial appDataStore mutation
    -> encrypted storage change -> existing popup reload
```

Keep the grouping/identity/order helpers in a small pure utility module, for
example `src/utils/prGrouping.ts`, tested without React/browser APIs. The input is
the final visible sorted array; pushing into each Map bucket retains within-group
order. Group ordering is a separate comparator. Complexity is O(n + r log r) for
n matching PRs and r repositories, beyond the existing sort/search pipeline.

Use feature components such as GroupingControls and RepositoryGroupedList;
ordinary buttons/panels do not need a generic accordion framework. Keep preference
load/handlers in the existing hook initially, passed through App to Dashboard.
Keep cards and FilterBar reusable as they are. A dedicated preference hook or
extraction of all existing filtering logic is not necessary for this feature.

The only proposed API/cache work is preserving canonical optional fields and
invalidating the old reduced cache representation. No endpoint, discovery,
concurrency, encryption algorithm, permission, authentication, notification,
toolbar badge, rate-limit or refresh-scheduling change is justified by grouping.

## Accessibility and browser checks

- Associate the visible Group by label with its select. Header names should read
  like “acme/api, 7 pull requests”; singularise one PR. Expose expansion through
  `aria-expanded` rather than repeating “expanded” in the label. Decorative
  chevrons are `aria-hidden`.
- Tab/Shift+Tab use document order. Enter and Space activate native buttons;
  arrow keys remain available for scrolling and native select behaviour. No
  custom key handlers are needed for disclosure activation.
- Preserve focus on the header when it collapses. If a focused descendant must
  be removed by a mode/filter/refresh change, move focus to the surviving group
  header or results control. Searching keeps input focus. Bulk actions keep
  focus on the bulk control; do not disable the focused control just because its
  action became a no-op.
- Use a visible focus indicator that survives forced colours, has room inside
  clipped containers and remains visible after scrolling. Test contrast and
  count text in both root themes; colour alone must not convey state.
- A single polite matching-results announcement can report settled search/filter
  counts. Do not make every repository count a live region or announce every
  card on each keystroke. Do not steal focus for background refreshes.
- Keep disclosure targets at least 24×24 CSS pixels and allow label wrapping.
  No expansion animation is needed; any later motion must respect reduced motion.
- Test packaged Chrome MV3 and Firefox MV2, actual toolbar panels, keyboard-only
  use and screen-reader output (for example NVDA with Firefox and Chrome). Builds
  and DOM assertions alone cannot establish screen-reader usability.

## Large-list assessment

These are design/markup estimates, not timings or measured accessibility results.
No grouping prototype or new runtime benchmark was built in this documentation PR.
Detailed cards contain dozens of elements including status SVGs and avatar rows;
roughly 40–100 elements per card is a planning range, varying with reviewers and
badges. Text nodes are additional. At 200 expanded cards that suggests roughly
8,000–20,000 card elements, not evidence of a particular frame rate.

| Scenario                          | Expected usability and rendering risk                                                 | #111 check                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 5 PRs / 2 repos                   | Low cost; grouping adds headers, so default None remains useful                       | Both modes, independent collapse, all five cards reachable                                               |
| 40 / 8                            | Group scanning and Collapse all reduce navigation effort                              | Counts, repeated expand/collapse, saved mixture, single scroll area                                      |
| 100 / 20                          | Expanded cards still make a long document; collapsed subtrees reduce mounted elements | Search responsiveness, keyboard route between headings, reopen persistence                               |
| 200 / 30                          | Highest proposed combined DOM/scroll burden; new users initially see all expanded     | Measure initial mount, typing and bulk expansion on a representative machine; record DOM count and trace |
| 100 / 1                           | Grouping provides almost no scrolling benefit while expanded                          | All 100 remain present; assess reading/scrolling with detailed cards, no cap                             |
| Same repo name / different owners | Bare name badges are ambiguous                                                        | Separate full-identity headers/keys/preferences and deterministic order                                  |
| Search hits a collapsed repo      | Hidden matches would defeat search                                                    | Reveal immediately, no collapse write; clear restores saved state                                        |
| Very long titles / repo names     | Variable card/header heights; potential clipping under overflow-x hidden              | Wrapping, zoom, focus rings, badge/count alignment and no clipped text in both engines                   |
| No matches                        | Empty groups and disabled bulk actions would be noise                                 | One empty message, selector retained, no group headers                                                   |

Keep the detailed cards in all cases. Collapsing saves space, but cannot claim a
performance gain when all groups are expanded. Conditional rendering limits DOM
for collapsed groups without pagination. Stable IDs and no height animation avoid
unnecessary remounts/jitter; opening or closing inherently changes document height.
Check scroll anchoring and focus near the bottom, and after activity reorders
groups. The new controls consume some of the small visible list area.

Do not introduce virtualisation, compact cards, content-visibility or deferred
search in #111 by default. Profile 100-in-one and 200/30 with realistic avatars,
long titles, cold/warm popup loads and both themes. Record DOM count, scripting,
layout/paint and input latency. If measured typing/mount delays are material,
first isolate expensive rerenders; evaluate content-visibility or virtualisation
as a follow-up with variable-height/focus/accessibility tests. Compact cards would
require a separate product decision about information loss.

## Implementation sequence and test plan for PR #111

1. Agree the remaining product choices below. Lock examples for search, bulk scope,
   ordering fallback and attention semantics before writing UI code.
2. Add optional canonical full identity/activity fields and cache projection/version
   coverage. Prove a 200 then 304 retains both values; legacy AppData stays readable.
   Assert no extra requests and continued independent review/CI calls.
3. Add pure grouping/identity/order helpers and unit cases for owner collisions,
   legacy URLs, invalid fields, ties, all sort modes and incomplete activity data.
4. Add the focused preference schema and narrow queued mutations, then hook loading
   and handlers. Extend [app-data-store unit tests](../../tests/unit/app-data-store.unit.test.ts)
   for defaults, corrupt values, bounds, no-op writes, batch operations and overlapping
   refresh/rapid preference changes. Test save rejection and lock/reset boundaries.
5. Add the separate results controls and controlled group headings, reusing cards.
   Add component tests for effective expansion, counts, focus and hidden subtrees.
6. Extend [preference journeys](../../tests/e2e/preferences.e2e.test.ts),
   [popup states](../../tests/e2e/popup-states.e2e.test.ts),
   [visual compatibility](../../tests/e2e/visual-compat.e2e.test.ts) and
   [lifecycle journeys](../../tests/e2e/lifecycle.e2e.test.ts). Keep None-mode
   expectations. Target cards by `.pr-card-accent` and group controls by stable
   semantic attributes rather than assuming every `li` means a card.
7. Exercise the scenario matrix and keyboard/screen-reader paths in both toolbar
   popups. Run compile, lint, formatting, unit tests, Chrome E2E and both production
   builds; add a focused Firefox grouping journey using the existing runtime patterns.

Current Chrome E2E uses real encrypted storage and mocked GitHub endpoints through
[the harness](../../tests/e2e/harness.ts). Most popup journeys use popup.html pages;
visual-compat also opens the actual Chrome action panel. The fixture response
builder currently hardcodes `acme` in base-repo URLs, so extend that fixture when
testing owner collisions and new full-name/activity fields. Use deterministic
timestamps, not live GitHub data or arbitrary delays.

Firefox coverage is more nuanced than some current documentation says:
[Advanced CI](../../tests/firefox/advanced-ci.firefox.test.ts) loads MV2 and tests
the real toolbar popup's resize, focus and dismissal;
[detail cache](../../tests/firefox/detail-cache.firefox.test.ts) loads MV2 and tests
encrypted cache/revalidation/reopen/sign-out/reset through extension pages. Neither
is a general grouping suite, and neither runs in the required Chrome E2E CI job.
The build-only Firefox statements in parts of the architecture/testing docs are
stale; the development guide and later testing notes describe focused runtime
checks. Do not confuse Chrome exercising Firefox CSS rules with Firefox runtime.

Actual browser restart/worker termination is not covered by current Chrome E2E.
Prove persisted rehydration at unit level plus close/reopen/unlock E2E, and manually
check a browser restart unless a reliable restart fixture is added. Do not claim
that a popup reload proves browser-restart behaviour.

## Acceptance criteria for PR #111

- [ ] New, v1.0.23 and invalid/missing-preference snapshots default to None;
      unchanged flat filtering/search/sorting/hide behaviour passes existing tests.
- [ ] Repository mode and independent collapse states survive popup closure,
      unlock and browser restart; new repositories expand by default.
- [ ] Full identities separate owners with identical repo names, including legacy
      snapshots; renamed/invalid identities follow the documented fallback rules.
- [ ] Visible counts reflect all matching PRs before collapse. No empty groups,
      pagination, five-card limit or missing card details.
- [ ] Bulk actions affect matching repositories in one queued operation and
      preserve absent choices; no-op actions do not write.
- [ ] Search reveals matching groups without storage writes; clearing restores
      previous choices. Search-time controls explain temporary expansion.
- [ ] Every existing sort works inside groups. Repository activity ordering and
      deterministic tie/fallback behaviour are separately tested, including 304
      and old-cache migration; no creation-time substitution or extra GitHub GETs.
- [ ] Reset Filters leaves grouping unchanged; Full Reset removes it; sign-out
      retains it encrypted and no stale submitted write resurrects it after reset.
- [ ] Preference validation, size limits, concurrent writes and failed-save UI are
      tested without disturbing other preferences or current/comparison snapshots.
- [ ] Total counts ship independently of attention semantics. No generic attention
      count; any Review requested badge follows the agreed table, handles unknown
      sources and has deterministic tests.
- [ ] Keyboard, focus, labels/counts and collapsed-panel accessibility are checked;
      native toolbar popup layout fits in light/dark themes in Chrome and Firefox.
- [ ] The complete large-list matrix is exercised, with measurements for the two
      worst expanded cases and recorded limitations. No speculative virtualisation.
- [ ] Existing CI/build checks pass; notifications, auth, encryption, required-detail
      failures, cooldowns and independent review/CI freshness remain unchanged.

## Remaining product decisions

The confirmed requirements above do not need reopening. These finer choices need
agreement; each has a recommended default so #111 can proceed with a clear scope.

| Decision                                                                                 | Recommended default                                                                                            |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Does “recent activity” mean canonical PR updated time rather than every review/CI event? | Yes. Preserve `updated_at`, order matching PRs only, and use whole-set alphabetical fallback when incomplete   |
| Ship Review requested badges in #111 or total PR counts only?                            | Total counts first unless the exact eligibility/unknown/draft rules above are accepted                         |
| Can users collapse search results or persist bulk changes while searching?               | No; force matches open temporarily and explain unavailable collapse controls                                   |
| Does Expand/Collapse all affect repositories absent from current results?                | No; operate on matching repositories only                                                                      |
| Should local search include owner/full identity?                                         | Keep existing title/name matching in #111; owner matching is a small separately approved behaviour change      |
| Accept the grouping preference cap/eviction policy?                                      | 1,000 collapsed identities; oldest explicit choices evicted only at the cap; never prune for transient absence |

## Verification of this investigation

Source inspection followed graph discovery/trace/snippet lookup and direct reads
against the v1.0.23 worktree. The graph reported changed file metadata, so it was
used for navigation rather than treated as fresh proof; mapping/cache and
preference/lifecycle claims were checked in source. No grouping prototype,
performance benchmark, application code, tests, dependencies or version files were
changed. Future acceptance boxes are intentionally unchecked.

Changed-file Prettier passed. All 26 relative references resolved and all 13
external URLs returned HTTP 200. The repository-wide `npm run check-format`
reported 207 warnings in unchanged checkout files; all 207 supported tracked
baseline files passed Prettier when read directly from Git. No unrelated files
were reformatted. The staged `git diff --check` passed and the staged file list
contained only this document. Full application regression tests were not run
locally for this documentation-only change. The required status is `verify` in
[buildandtest](../../.github/workflows/build.yml), not a verify.yml file or npm
verify script. It runs compile/lint, both production builds, unit tests and
deterministic headless Chrome E2E even for this documentation PR. Inspect that
status after opening the PR and report the outcome in the PR/final report.
