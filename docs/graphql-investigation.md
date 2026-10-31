# GitHub GraphQL migration investigation

Investigated against `origin/main` at `8a255e1` on 2026-10-31.

## Recommendation

**Retain REST in production.** The [final option comparison and recommendation](graphql-recommendation.md)
weighs full GraphQL, hybrid and REST-only approaches. A constrained hybrid that
keeps REST discovery/review/CI and batches canonical metadata is the preferred
next experiment; it has not been implemented or benchmarked.

The acceptance criterion is a meaningful improvement in API efficiency and
refresh performance **without changing existing user-facing behaviour**.
The investigation does not yet establish that result. Retain the production
REST fetcher. GraphQL has promising request-count savings, but the compact
experiment fails behaviour equivalence. A limited live custom-query sample now
shows lower fetcher latency and payload volume, but does not demonstrate a
behaviour-preserving browser refresh improvement. Its 303-to-6 fixture comparison is not evidence for a suitable
replacement under this criterion.

A hybrid retains the existing REST review/CI operations. The discovery-plus-
metadata variant analysed below also replaces searches; the final recommendation
prefers initially retaining REST discovery to preserve its completeness signal.
Either variant requires parity, error handling and performance evidence before
adoption. Adopting different review/CI summaries is outside this goal.

The [behaviour-gap assessment](graphql-behaviour-gaps.md) identifies summary
information loss, unresolved cross-API guarantees and fixable integration gaps.
It lists evidence and REST preservation options without claiming that all raw
GraphQL alternatives are intrinsically incapable of matching the domain rules.

This PR contains an isolated, browser-independent proof of concept in
[`src/experiments/githubGraphql/client.ts`](../src/experiments/githubGraphql/client.ts).
No production entrypoint imports it. It uses native `fetch` through a required
injected transport and the existing Zod dependency. There are no dependency,
permission, storage, authentication, UI, polling, or release changes.

## Current REST behaviour

Source inspection, including a codebase-memory call trace, establishes:

- [`prManager.ts`](../src/background/prManager.ts) checks the persisted cooldown,
  decrypts the token, and fetches `/user` before calling `fetchPullRequests`.
  Successful results update the badge, encrypted snapshot, timestamps and
  notification comparison state. Required failures preserve the cached snapshot.
- [`api.ts`](../src/background/api.ts) searches authored, review-requested, **and
  reviewed-by** open PRs, or uses one custom query verbatim. Each search requests
  100 items per page, up to 1,000 per search. It rejects incomplete/unusable pages.
  Default discovery sources are unioned and duplicate PRs fetched only once.
- Canonical REST PR details are required. Four PR work units run concurrently;
  reviews and checks run concurrently within a work unit. The current design
  therefore bounds that phase at eight simultaneous supporting requests.
- Review status uses the last returned review per numeric user ID. Any remaining
  change request wins over approval; otherwise status is pending. Reviews are
  fetched with the endpoint's default pagination, not an exhaustive history.
- CI uses check runs: failure/timed-out means failing, all completed/success
  means passing, otherwise pending. Combined commit status is requested only
  when there are no check runs. Neither supporting endpoint paginates today.
- Optional failures degrade to pending. Recognized optional cooldowns propagate
  to the manager while the complete PR snapshot can still succeed. Required
  failures prevent a successful snapshot; a required rate limit also stops
  scheduling additional PR work units.

The graph reported changed file metadata; material conclusions above were checked
against the current source rather than relying on index freshness.

### Request sequence and endpoint costs

```mermaid
flowchart TD
    A[Alarm or popup refresh] --> B{Session, cooldown and throttle allow work?}
    B -->|No| X[No GitHub requests]
    B -->|Yes| C[GET /user]
    C --> D[Three default searches in parallel, or one custom search]
    D --> E[Finish sequential pages within each search]
    E --> F[Union sources and deduplicate PR URLs]
    F --> G[Up to four PR work units]
    G --> H[GET canonical PR detail]
    H --> I[GET reviews and GET check-runs in parallel]
    I --> J[GET combined status only when check-runs is empty]
    J --> K[Collect results and remove stale closed default hits]
    K --> L[Update badge, encrypted snapshot, timestamps and notification state]
```

This diagram shows the successful request path. A required user/search/detail
failure exits before successful snapshot effects; optional review/CI failures
can reach the final step with pending status and a propagated cooldown.

| Phase              | Endpoint                                             | Calls in a successful refresh | Dependency / response use                                                                                   |
| ------------------ | ---------------------------------------------------- | ----------------------------: | ----------------------------------------------------------------------------------------------------------- |
| Identity           | `GET /user`                                          |                             1 | Login supplies default search qualifiers. Runs even for custom queries. Required.                           |
| Discovery          | `GET /search/issues?q=...&per_page=100&page=...`     |                           `S` | Three default queries or one custom query; sequential pagination per query, up to ten pages each. Required. |
| Canonical metadata | `GET /repos/{owner}/{repo}/pulls/{number}`           |                           `N` | Author, reviewers, current state, repository and head SHA. Required before supporting requests.             |
| Reviews            | `GET /repos/{owner}/{repo}/pulls/{number}/reviews`   |                           `N` | Existing latest-per-user reduction over the returned default page. Optional.                                |
| Checks             | `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` |             `C`, normally `N` | Skipped if usable repository/head-SHA context is absent. Optional.                                          |
| Legacy CI fallback | `GET /repos/{owner}/{repo}/commits/{sha}/status`     |            `F`, from 0 to `C` | Runs only after a successful empty check-runs response, not after a check-runs error. Optional.             |

Here `N` counts distinct canonical PRs hydrated, **before** stale closed/merged
default hits are removed. Using only the final visible count can understate
cost. Deduplication across default searches avoids repeated detail/supporting
requests, but each search still pays for all its own result pages. An empty
search costs one request. With capped per-query counts `R_i`:

```text
S = sum(max(1, ceil(R_i / 100)))
core requests = 1 + 2N + C + F
total requests = S + 1 + 2N + C + F
usual valid-CI-context case (C = N): total = 1 + S + 3N + F
```

The following are **full-refresh estimates**, derived from the source flow;
the later fixture table measures only the fetcher boundary, excluding `/user`.
Default examples assume each of the three searches returns the same `N` PRs,
and all PRs have valid CI context. Custom examples use one query.

| Hydrated PRs | Default search calls | Core calls, checks / universal fallback | Default total, checks / fallback | Custom total, checks / fallback |
| -----------: | -------------------: | --------------------------------------: | -------------------------------: | ------------------------------: |
|            0 |                    3 |                                   1 / 1 |                            4 / 4 |                           2 / 2 |
|            1 |                    3 |                                   4 / 5 |                            7 / 8 |                           5 / 6 |
|           10 |                    3 |                                 31 / 41 |                          34 / 44 |                         32 / 42 |
|           50 |                    3 |                               151 / 201 |                        154 / 204 |                       152 / 202 |
|          100 |                    3 |                               301 / 401 |                        304 / 404 |                       302 / 402 |
|        1,000 |                   30 |                           3,001 / 4,001 |                    3,031 / 4,031 |                   3,011 / 4,011 |

Search and core requests consume separate REST primary rate-limit resources;
adding them describes HTTP volume, not a single shared primary budget. See
[GitHub's rate-limit resource definitions](https://docs.github.com/en/rest/rate-limit/rate-limit).
The configured five-minute alarm/automatic-refresh interval implies about twelve
eligible refreshes per hour. At 100 PRs this models **3,612 core + 36 search**
requests per hour normally, or **4,812 core + 36 search** with universal fallback.
These estimates assume continuous eligibility, no failures/cooldowns and no
manual refreshes; they are not observed account consumption.

### Scheduling, avoided work and performance limits

- A locked/missing session, active persisted cooldown, automatic refresh interval
  or manual throttle can stop work before `/user`. Concurrent refresh requests
  in the same session share one in-flight operation. Normal automatic refreshes
  use a five-minute interval; manual refreshes have a four-second throttle.
- Discovery has at most three requests in flight by default, or one for a custom
  query. All searches settle before detail work starts; failure of one default
  search does not cancel its siblings. The page cap is per search, so three
  default queries can hydrate up to 3,000 disjoint PRs.
- Each of four workers retains its slot through detail, review/check and optional
  fallback completion. Detail must finish before supporting calls start; reviews
  and checks overlap, and fallback status waits for checks. The detail phase
  therefore has at most eight GitHub requests in flight, not an unbounded `2N`.
- There are no immediate request retries in this path. A required rate-limit
  result stops new queued PR work after its worker result is collected; already
  active work settles. Optional failures can still finish a successful refresh
  and persist the latest cooldown for subsequent refresh suppression.
- The fetcher does not explicitly send conditional-request validators or reuse
  cached PR metadata to omit per-PR requests. Encrypted cached data preserves the
  UI across failures but is not an incremental API cache. Browser/network caching
  effects were not measured.
- Token onboarding independently calls `/user` from `useAuth` to validate the
  classic token's `repo` scope. That request is outside these refresh counts.

The main scaling cost is the per-PR `3N` (or `4N`) fan-out, including unchanged
PRs. Concurrency limits reduce burst pressure but do not reduce call count.
Wall time also includes token/storage work, JSON parsing, mapping, encryption and
notification handling; these browser-side costs have not been profiled. The
[live fetcher measurements](graphql-live-measurements.md) separately record
request counts, decoded body sizes, latency and API telemetry. A request-count reduction alone cannot quantify refresh
speed. An incremental REST-cache alternative also deserves comparison before
attributing all potential improvement to GraphQL; GitHub documents
[authenticated conditional requests](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests).

## Field and behaviour mapping

| Existing domain field or behaviour           | GraphQL candidate                                         | Assessment                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric `id`                                 | `PullRequest.fullDatabaseId`                              | Preserve REST numeric identity for hidden IDs and notification history. Reject null/unsafe integers; do not substitute opaque node `id` or PR `number`.           |
| Title, link, repository, draft, created date | `title`, `url`, `repository.name`, `isDraft`, `createdAt` | Direct mapping.                                                                                                                                                   |
| Open/closed state                            | `state`                                                   | Map MERGED and CLOSED to REST `closed`; exclude these from default searches, retain in custom searches. Search-index freshness still needs evaluation.            |
| Author                                       | `author { login avatarUrl }`                              | Nullable actor; map a missing author to undefined.                                                                                                                |
| Requested reviewers                          | `reviewRequests.nodes.requestedReviewer`                  | Union of user-like actors and teams. Map User/Bot/Mannequin; omit Team/EnterpriseTeam to match the domain's individual-reviewer field. Reject null/unknown types. |
| Discovery sources                            | Three separate search strings                             | Retain exact current qualifiers and source union. Custom search has no discovery-source annotations.                                                              |
| Review label                                 | `reviewDecision`                                          | Compact alternative, **not equivalent** to current latest-review-per-user calculation. Null/REVIEW_REQUIRED maps to pending.                                      |
| CI label                                     | `statusCheckRollup.state`                                 | Compact alternative combining checks and statuses; current REST prefers check runs and ignores statuses whenever checks exist.                                    |
| API budgets                                  | HTTP headers and `rateLimit { cost remaining resetAt }`   | Preserve telemetry; real cost must be observed. GraphQL errors may accompany HTTP 200.                                                                            |

GitHub documents the [PR fields and reviewer unions](https://docs.github.com/en/graphql/reference/pulls)
and the [combined check/status rollup](https://docs.github.com/en/graphql/reference/commits#statuscheckrollup).
`fullDatabaseId` replaces the deprecated `databaseId`. Numeric IDs beyond
`Number.MAX_SAFE_INTEGER` require a separate domain/storage migration, not a
lossy conversion in this experiment.

Two explicit semantic counterexamples are encoded in tests:

- One review is approved, but the aggregate decision remains REVIEW_REQUIRED
  (for example, further approvals are required): REST shows approved; the
  summary experiment shows pending.
- Check runs pass while a legacy commit status fails: REST shows passing;
  a failing combined rollup maps to failing.

These synthetic examples demonstrate a mapping difference, not evidence that
GitHub produced these responses for a particular live repository. Cancelled,
neutral, skipped and action-required checks, dismissed reviews, branch protection
and stale approvals need broader semantic fixtures before choosing a replacement.
For compatibility, prefer retaining the existing REST review/check/status
operations in a hybrid experiment. A full GraphQL replacement would need to
reproduce their current ordering, default-page selection, check-run precedence,
optional-failure degradation and cooldown behaviour, as well as the reducers.
Fetching a more complete history can itself change the displayed result and
does not prove parity. Nested pagination increases requests and complexity and
needs its own measurements.

### Behaviour-preservation assessment

| Area                                                     | Current experiment                                                                                              | Acceptance status                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Successful common metadata and discovery-source union    | Matching synthetic fixtures produce equal domain arrays                                                         | Demonstrated only for the supplied fixtures  |
| Review and CI labels                                     | Counterexample produces different labels                                                                        | Fails equivalence                            |
| Optional field failures                                  | Any GraphQL error rejects the entire refresh; REST can succeed with pending status                              | Fails equivalence                            |
| Nullable/partial metadata and reviewer connections       | Experiment validates more strictly than REST and rejects truncated nested data                                  | Failure-path parity unproven                 |
| Search syntax, selection, ordering and freshness         | Matching identity sets in two live repository custom queries; broader default discovery untested                | Partially observed, not established          |
| Hidden state, notifications, cache, badge and timestamps | Numeric identity mapping tested; experiment is not wired to manager                                             | Integration parity unproven                  |
| Refresh performance and rate-budget consumption          | Live fetcher timings/bytes and primary GraphQL costs recorded; browser refresh and compatible hybrid unmeasured | Partial evidence for a non-equivalent client |

These gaps make the compact experiment unsuitable for a production switch.
Rejecting partial data protects cached data, but does not by itself preserve
REST's successful-refresh and optional-error behaviour.

### Reviewer information

`PullRequest.reviewRequests(first: ..., after: ...)` exposes outstanding requests
separately from submitted reviews. Its `requestedReviewer` is a nullable union:
User, Bot, Mannequin, Team or EnterpriseTeam. Select `__typename` and the
appropriate inline fragment; user-like `login`/`avatarUrl` map to the current
`requested_reviewers` objects. Team requests must not become individual reviewer
avatars or be used as evidence that a particular user has already reviewed.
The PoC omits teams and rejects null reviewers; matching REST's handling of
inaccessible/deleted actors remains a parity requirement.

Each PR owns an independent review-request connection. Fetching one search page
does not finish these nested connections: request their `pageInfo.endCursor`
and continue any with `hasNextPage`, or use a deliberately validated fallback.
The PoC currently rejects more than 100 requests rather than silently truncating.
Submitted reviews come from `reviews` or `latestReviews`, not `reviewRequests`.
See the [review request and review connections](https://docs.github.com/en/graphql/reference/pulls).

### Review state: candidate sources

| GraphQL field    | What it provides                                                | Suitability for preserving current labels                                                                                                          |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewDecision` | Aggregate APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or null  | Already mapped in the PoC, but the counterexample shows different output from the current reducer.                                                 |
| `latestReviews`  | Latest non-pending review per user                              | Closer to the reducer's intent, but excludes pending reviews and considers a different selection from REST's first page. Not a proven replacement. |
| `reviews`        | Individual review state, author, submitted timestamp and cursor | Most control over compatibility; requires matching author identity, ordering and page selection before applying the existing precedence.           |

`latestOpinionatedReviews` is another convenience connection with a
`writersOnly` filter. It likewise cannot be assumed to reproduce the current
unfiltered page/reducer semantics. GitHub documents
[latest-review selection and review states](https://docs.github.com/en/graphql/reference/pulls#pullrequest).
For `reviews`, retain a stable reviewer identity when available, not merely a
display name; nullable/deleted authors need an explicit policy. Do not request
only APPROVED/CHANGES_REQUESTED reviews: the current reducer lets a subsequent
COMMENTED, DISMISSED or PENDING entry overwrite that same user's earlier state.
Such a later entry can change an approved label back to pending; filtering that
entry out can leave the approval incorrectly visible.

The current REST request has no pagination parameters. GitHub specifies a
chronological response with a default page size of 30, so current behaviour is
latest-per-user **within that returned page**, not latest across all history.
`reviews(first: 30)` is only a candidate until GraphQL ordering/selection matches
are established; `last: 30`, `latestReviews`, or fetching every page can produce
different results. Preserving this limitation is part of this investigation;
correcting it would be separate behaviour-changing work. Source:
[REST review ordering and pagination](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request).

### CI/check status: aggregate versus raw data

| GraphQL path                          | Available data                                        | Compatibility concern                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PullRequest.statusCheckRollup.state` | Combined SUCCESS, FAILURE, ERROR, PENDING or EXPECTED | Compact mapping is implemented; combines checks and legacy statuses, unlike current checks-first logic.                                                 |
| `statusCheckRollup.contexts`          | Union of `CheckRun` and `StatusContext`               | Inspect `__typename`; raw check `status`/`conclusion` and context `state` permit separate reductions, but all relevant pages and ordering still matter. |
| `Commit.checkSuites.nodes.checkRuns`  | Check suites and individual runs, with filter options | Alternative raw check source; two nested pagination levels and cross-suite selection complicate matching REST.                                          |
| `Commit.status.state`                 | Combined legacy commit-status state                   | Candidate for REST's fallback only after confirming an empty check-run result; a missing rollup alone is not proof of emptiness.                        |

The [commit schema](https://docs.github.com/en/graphql/reference/commits) documents
the rollup/context union, legacy status and check-suite access. The
[check schema](https://docs.github.com/en/graphql/reference/checks) exposes run
status/conclusion and check-run filter options. For an expanded PoC, pin CI data
to the exact `headRefOid` used for metadata. Validate fork/base repository and
deleted-ref cases against REST's base-repository/head-SHA lookup; querying an
unrelated branch tip could report a different commit's CI.

To preserve the current reducer, separate raw CheckRuns from StatusContexts:

1. A returned run with FAILURE or TIMED_OUT makes CI failing.
2. Otherwise, a nonempty run set passes only if every run is COMPLETED/SUCCESS.
   CANCELLED, NEUTRAL, SKIPPED, ACTION_REQUIRED and unfinished runs therefore
   remain pending under current code; do not reinterpret them as passing/failing.
3. Only a successfully retrieved empty run set permits the legacy-status
   fallback: SUCCESS passes, FAILURE/ERROR fails, other states remain pending.
4. A failed optional checks/status lookup yields pending and retains any cooldown.

REST currently defaults to the first 30 check runs with `filter=latest`; it does
not traverse all check runs/suites. Neither concatenating every GraphQL suite
nor taking the first 30 mixed rollup contexts proves equivalent selection. The
corresponding [REST defaults](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)
must be matched in any full replacement. In particular, passing checks plus a
failing legacy status must still display passing when the check list is nonempty.

### Error isolation and remaining evidence

Reviewer metadata is part of required canonical detail, while review-state and
CI lookups are optional today. Putting all three into one GraphQL selection can
return partial data/errors and may null a parent field. A future adapter must
inspect error paths and surviving data to preserve required-versus-optional
outcomes, or split optional requests. A blanket rejection of every `errors`
array, as in the compact experiment, intentionally does not establish parity.

Before replacing supporting REST calls, paired fixtures must cover review
supersession/dismissal/comment-only/pending cases; histories beyond 30 entries;
user/bot/team/null actors; mixed checks/statuses; empty/null rollups; all current
CI conclusions; reruns/multiple suites and pagination; fork/head changes; and
permission/rate-limit failures scoped to each optional field. Existing PoC tests
cover summary mapping, null author/rollup, team omission, oversized connections
and explicit summary counterexamples. Raw-history/context pagination and
error-path-aware degradation are not implemented or validated. Retaining the
existing REST supporting calls remains the lower-risk compatibility candidate.

### Representative paired scenarios

[`graphql-scenarios.unit.test.ts`](../tests/unit/graphql-scenarios.unit.test.ts)
executes both clients with fixed responses from
[`review-scenarios.ts`](../tests/fixtures/graphql/review-scenarios.ts). Its 14
tests cover ten review combinations, three successive-refresh/later-commit
cases, and a partially overlapping default-discovery case:

| Scenario                                          | REST outcome                            | Supplied GraphQL summary outcome |
| ------------------------------------------------- | --------------------------------------- | -------------------------------- |
| Two outstanding reviewers, no submitted reviews   | Pending, both reviewer avatars retained | Same                             |
| Two approvals                                     | Approved                                | Approved                         |
| Approval and another reviewer's changes requested | Changes requested                       | Changes requested                |
| Multiple comment-only reviews                     | Pending                                 | Pending                          |
| Same reviewer: changes requested then approval    | Approved                                | Approved                         |
| Same reviewer: approval then changes requested    | Changes requested                       | Changes requested                |
| Same reviewer: approval then comment              | Pending                                 | Approved: explicit mismatch      |
| Dismissed approval                                | Pending                                 | Pending                          |
| Same reviewer: approval then pending review       | Pending                                 | Approved: explicit mismatch      |
| One approval, aggregate still requires review     | Approved                                | Pending: explicit mismatch       |

The later-commit tests perform two refreshes of the same PR identity: an old
passing head followed by a new in-progress head. They assert the actual REST
check-request URLs switch from `head-old` to `head-new`, CI becomes pending,
and review handling covers retained approval, dismissed approval and a summary
requiring re-review while the REST review remains approved. The latter is an
additional expected review-label mismatch. These fixtures do not infer GitHub's
branch-protection/dismissal behaviour and do not prove GraphQL head-SHA pinning;
the PoC consumes the supplied current-head rollup without explicit pinning.

The overlap case returns one PR from authored + reviewed discovery and another
from review-requested + reviewed discovery. It asserts equal mapped results,
source unions, preservation of two requested reviewers, changes-requested
precedence, and one REST canonical-detail fetch per PR. Observed fixture counts
are nine REST calls versus three GraphQL calls, excluding identity lookup.

These are deterministic client/mapping tests, not server-policy or performance
measurements. GraphQL decisions are explicit fixture inputs, rather than being
calculated from the synthetic REST review history. Matching cases demonstrate
the stated inputs; expected mismatches keep the behaviour-preservation concern
visible instead of weakening assertions to claim parity.

## Proof-of-concept boundaries

The dedicated [pagination, errors and API-limit comparison](graphql-pagination-errors-limits.md)
contrasts REST page numbers with GraphQL cursors/nested connections, required
versus optional outcomes, HTTP 200 errors, cooldown integration and primary/
secondary budgets. It includes paired fixtures for the optional-error and
rate-limit-classification gaps. These are additional compatibility requirements,
not production changes.

### Retrieving the three default PR sets

The isolated `investigateGraphql` function accepts a token, login, mandatory
fetch-compatible transport and optional cancellation signal. With no nonblank
custom query, it retrieves all three current discovery sets:

| Source annotation  | Search query                                            |
| ------------------ | ------------------------------------------------------- |
| `authored`         | `is:open is:pr author:{login} archived:false`           |
| `review-requested` | `is:open is:pr review-requested:{login} archived:false` |
| `reviewed`         | `is:open is:pr reviewed-by:{login} archived:false`      |

Each search has its own cursor/count state. Results are deduplicated by numeric
PR identity while preserving the union of source annotations. Previously
reviewed open PRs are retained even when they have no outstanding requested
reviewers. Authored drafts are also retained for existing UI filtering.

[`defaultDiscoveryFixture`](../tests/fixtures/graphql/responses.ts) supplies
distinct authored, requested and reviewed-only results, one PR overlapping all
three sources, and a second page of reviewed PRs. Tests verify 53 unique PRs
from four requests, independent cursors and correct source annotations. Separate
tests reject failures in each source or the reviewed-search continuation rather
than returning a partial list. Blank custom queries use default discovery;
nonblank custom queries replace it, matching the existing query selection.

Tests call the function with a mocked transport and fixed test token. The
function is not connected to popup/background execution, has no storage or
notification side effects, and introduces no dependency. This proves the
discovery orchestration against fixtures; GitHub's live search results and
summary-based status parity remain subject to the limitations below.

### Limits and failure handling

- Sequential search requests, 50 PRs per page, 1,000 results per search. Custom
  query text is sent as a variable without rewriting it. Mixed Issue/PR searches
  fail explicitly instead of silently dropping Issue nodes.
- At most 100 review requests per PR. If a nested connection has another page,
  the experiment rejects the refresh; it does not claim complete reviewer data.
  A production version needs nested pagination or an approved fallback policy.
- Malformed data, null nodes, missing/unsafe identities, duplicate results within
  a search, repeated/missing cursors, premature termination, HTTP errors and
  GraphQL errors reject the operation. No partial list is returned on failure.
- A 1,000-result search cap is explicit through `truncated`, unlike a claim of
  complete discovery beyond that ceiling. A production caller must decide how
  to expose this limitation. Changing search contents between pages cannot be
  fully detected by count/cursor checks.
- Any nonempty GraphQL `errors` rejects even HTTP 200 responses containing data.
  The error retains the original Response (including headers and unread body).
  There are no automatic retries, waits, logging of tokens, browser side effects
  or storage writes. Cancellation is checked around asynchronous boundaries.
- Successful responses return per-page rate-limit telemetry, which is synthetic
  in these tests. This is not a production cooldown implementation. In particular,
  passing an HTTP 200 GraphQL error to the existing HTTP-only classifier is
  insufficient; integration needs a GraphQL-aware error adapter.

GitHub supports [search syntax and cursor pagination with a 1,000-result ceiling](https://docs.github.com/en/graphql/reference/search).
Two live custom queries returned matching identity sets; this does not establish
general search-index, ordering or default-query compatibility. Fixture tests
validate the client contract; successful live query execution is recorded
separately in the [measurement report](graphql-live-measurements.md).

## Measured results: deterministic fixtures

Reproduce with:

```sh
npx vitest run tests/unit/graphql-investigation.unit.test.ts
```

The tests execute the **existing REST fetcher** and the experimental GraphQL
client with fixed synthetic responses, count actual mocked transport invocations,
and assert equality of the mapped PR arrays for matching summary states. All
three default searches deliberately return the same PRs to test deduplication
and source union. REST search uses one page per search in these cases; GraphQL
uses pages of 50. These measurements exclude the manager's `/user` request and
token setup. They do not measure network performance.

| Unique PRs | REST default, passing checks | GraphQL default | REST default, no checks/status fallback | REST custom, passing checks | GraphQL custom |
| ---------: | ---------------------------: | --------------: | --------------------------------------: | --------------------------: | -------------: |
|          1 |                            6 |               3 |                                       7 |                           4 |              1 |
|         10 |                           33 |               3 |                                      43 |                          31 |              1 |
|         50 |                          153 |               3 |                                     203 |                         151 |              1 |
|        100 |                          303 |               6 |                                     403 |                         301 |              2 |

The fallback scenario produces the same mapped arrays and GraphQL call counts
as the passing-check scenario. A separate synthetic 1,200-match custom search
returns 1,000 mapped PRs, marks truncation, and stops after 20 calls. Error,
pagination, nullable-field, status-mapping and cancellation scenarios also run
without live credentials. The investigation suite has 54 tests, including the
distinct-source and required-discovery-failure cases.

The fixture results do not measure live GitHub timing, payload size or API cost.
See [separate live measurements](graphql-live-measurements.md) for those results
and limitations. Memory, CPU and browser end-to-end latency remain unmeasured.
The fixture `cost: 1` only tests telemetry plumbing and must not be used as a cost estimate. Production bundle isolation is
checked with both browser builds and a search for the experimental query name
in their output.

## Estimates and unverified expectations

Let `N` be unique PRs and `R_i` the raw result count of search `i`, capped at
1,000. REST total refresh calls are approximately:

```text
S = sum(max(1, ceil(R_i / 100)))
normal:   1 + S + 3N
fallback: 1 + S + 4N
```

The leading 1 is the background `/user` request. The compact GraphQL experiment,
if integrated while retaining that identity request, would use:

```text
1 + sum(max(1, ceil(R_i / 50)))
```

For the 100-PR overlapping-default fixture, full refresh counts would therefore
be 304/404 REST calls versus 7 GraphQL calls. These are extrapolations from the
fixture boundary, not full-manager measurements. At 1,000 results in each of
three fully overlapping searches, the model gives 3,031/4,031 REST calls versus
61 GraphQL calls. Disjoint results, overlap, nested continuations, retries,
hybrid REST support and query page-size tuning change these numbers.

Fewer HTTP calls plausibly reduce fan-out overhead, but do not establish faster
refreshes or proportionate rate-budget savings. GraphQL has a distinct primary
point budget, shared secondary constraints, a node cap and timeout/resource
limits. A page of 50 PRs with up to 100 nested reviewer requests selects roughly
5,050 connection nodes, below the documented 500,000-node ceiling; this is a
shape estimate, not server-cost evidence. See GitHub's
[rate and query limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

### Behaviour-preserving hybrid estimate

Retaining REST review and CI requests while replacing search and canonical
metadata with GraphQL changes the estimate to:

```text
G = sum(max(1, ceil(R_i / 50)))
normal hybrid:   1 + G + 2N
fallback hybrid: 1 + G + 3N
```

For 100 PRs overlapping all three default searches, this is **207 versus 304**
calls normally (about 32% fewer), or **307 versus 404** with universal combined
status fallback (about 24% fewer). These are estimates, not measurements of an
implemented hybrid. They assume one GraphQL metadata page per 50 results,
complete reviewer metadata and no extra hydration/fallback requests. The hybrid
query would also need `headRefOid` and repository identity to address the existing
CI endpoints; the compact query has not implemented that path.

Keeping REST canonical details as well as REST supporting calls would instead
use `1 + G + 3N` normally: 307 calls in this case, exceeding the 304-call baseline.
Replacing discovery alone therefore has no demonstrated efficiency benefit.

Request count also misses the critical path. The baseline performs its three
searches concurrently, then bounds detail/status work to four PRs. The experiment
serializes all GraphQL pages. In a simplified model where every request takes
the same time L, all statuses need one request, and PRs finish in groups of four,
the 100-PR baseline takes roughly `L + 25 * (L + L) = 51L` after identity lookup;
the proposed hybrid takes `6L + 25L = 31L`. For one PR the same assumptions give
`3L` for REST versus `4L` for the hybrid. These are scheduling estimates, not
timing measurements; heavier GraphQL queries, network variability, processing
cost and actual worker overlap can change or reverse the outcome.

A performance comparison should measure equivalent successful and failed
refreshes at 0, 1, 10, 50, 100 and paginated result counts, including overlap,
fallback statuses and partial failures. Report end-to-end median/tail latency,
requests by API resource, response bytes and observed GraphQL cost separately.
Use deterministic fixtures to prove output/error/side-effect parity; do not
present synthetic delays or local Vitest duration as evidence of GitHub speed.

## Migration gates and suggested follow-up

1. Preserve current review/CI semantics. Build a separate hybrid comparison that
   retains the existing supporting REST operations and tests matching outputs
   and optional-error outcomes, including large connections and inaccessible
   PRs. Full-GraphQL alternatives must meet the same parity requirement; adopting
   aggregate summaries does not satisfy this goal.
2. Extend the successful live custom-query execution to a schema-validated,
   behaviour-preserving comparison on representative repositories. Record real
   costs/headers, response bytes, wall time, failures and semantic mismatches
   separately from fixture measurements. Keep automated CI credential-free.
3. Keep classic-PAT `repo` validation in `useAuth` for the initial integration.
   GraphQL uses the same API host and accepts PAT authentication; adding
   fine-grained token support is a separate onboarding/permissions change.
   Public/private access, org SSO and field permissions still need validation.
   See [GitHub authentication guidance](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql).
4. Add a small GraphQL transport/error adapter behind the current fetch-result
   boundary, preserving HTTP 200 rate-limit metadata and the existing persisted
   cooldown, session-generation checks and abort signal. Reject failed discovery
   before badge/storage/timestamp/notification effects. Do not fall back blindly
   to REST after a rate limit or permission failure.
5. Retain the client-only Chrome MV3/Firefox MV2 architecture, numeric identity,
   encrypted state and current discovery/filtering behaviour. No GraphQL SDK,
   cache framework, backend, new host permission or code generator is needed.
   Add manager integration and deterministic Chrome E2E coverage only when the
   production path is wired, plus both browser builds and Firefox runtime
   validation where available.

## Validation

- Before changes: unit suite passed, 24 files / 377 tests.
- Initial implementation: compilation, lint and unit suite passed, 25 files /
  425 tests. Additional discovery fixtures extend the investigation suite from
  48 to 54 tests; compilation, lint, the focused suite and the full 431-test unit
  suite pass.
- Live-measurement tooling adds three credential-free instrumentation tests.
  Compilation, lint, all 434 unit tests and both production builds pass. The
  manual live results and telemetry caveats are recorded separately in
  [the measurement report](graphql-live-measurements.md).
- Representative reviewer/commit/overlap coverage adds 14 paired scenario tests.
  All 448 unit tests pass, along with compilation, lint and formatting for the
  changed files. Production code and measurement artifacts are unchanged by
  this test-only addition.
- Pagination/error/limit analysis adds two deterministic protocol comparisons;
  all 450 unit tests, compilation, lint and changed-file formatting pass.
- Changed-file Prettier checks passed. `npm run check-format` reported 122
  existing file issues, including unrelated local artifacts; none were the four
  files introduced by this investigation. Unrelated files were left unchanged.
- `npm run build:all` passed for Chrome and Firefox after rerunning outside the
  Windows sandbox (`spawn EPERM` on the initial attempt). Build output retained
  dependency annotation and Firefox data-collection warnings. No experimental
  query/error marker was present in either production output; source search
  found the query only in the experimental module.
- E2E is not required for this unconnected experiment: production user workflows
  are unchanged. No live GitHub PR-data requests or credentials are used by tests.
