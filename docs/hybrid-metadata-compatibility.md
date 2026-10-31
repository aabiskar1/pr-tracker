# Hybrid metadata compatibility follow-up

**NO-GO for production integration of this candidate yet.** The original author
representation gap is resolved with verified REST discovery data, and the extra
reviewer attributes have an explicit, tested compatibility policy. However, two
paired open-PR measurements regress in latency at every measured size. Safe
fallback is frequent. Keep the production REST pipeline enabled and investigate
those costs before a separate feature-flagged integration PR.

This follows merged [#99](https://github.com/aabiskar1/pr-tracker/pull/99),
[#100](https://github.com/aabiskar1/pr-tracker/pull/100) and
[#101](https://github.com/aabiskar1/pr-tracker/pull/101), starting at main
`c3c06d7ebd7625a319d584edf2d78f09665bff18`. The original six GraphQL research
files, experiments, scripts and tests, plus #101's recommendation and artifacts,
were reviewed. [The #101 report](hybrid-metadata-recommendation.md) remains
historical evidence; the measurements below supersede its compatibility decision.

## Architecture and author compatibility

The existing isolated implementation and measurement runner are extended. REST
still performs identity, discovery, reviews and CI. Only canonical PR metadata is
batched through GraphQL, sequential batches of 20 (maximum 50), followed by the
unchanged four-worker REST supporting calls. Review-request connections remain
bounded at 100; incomplete connections use one memoized REST detail fallback.
There are no production imports of the experiment and no extension changes.

REST discovery responses are observed within one trial/session, before hydration.
The client preserves the exact REST author login/avatar representation only if:

- Both responses identify the same PR through REST `node_id` / GraphQL PR `id`.
- Discovery `updated_at` exactly matches GraphQL `updatedAt`.
- Author global node ID, exact login and actor type agree (User or Bot).
- Every duplicate discovery observation agrees. An invalid or conflicting
  observation remains ambiguous for that trial; later observations cannot erase it.

Two explicitly null authors are compatible only after PR identity/freshness
verification. Missing evidence, unsupported author actors (including mannequins),
renames, stale timestamps, malformed data and conflicts require REST detail
fallback. Evidence is never sourced from the encrypted cache or reused between
refreshes. Direct raw GraphQL diagnostics deliberately omit this preservation
option; the evaluation adapter always enables it, including an empty evidence map.

**An important resolved identifier issue:** REST issue search numeric `id` is an
issue ID, not the canonical REST PR ID. Search and GraphQL PR global IDs match;
GraphQL `fullDatabaseId` matches the REST canonical PR numeric ID. Fixtures now
use different numeric issue/PR IDs, and live canonical comparisons verify the
numeric PR ID independently. No GraphQL opaque ID replaces application IDs.
See GitHub's [cross-API global ID contract](https://docs.github.com/en/graphql/guides/using-global-node-ids).

### Avatar investigation

The historical 40-PR sample reproduces all 28 raw avatar differences. All 40
REST-discovery/GraphQL author node IDs matched in a bounded read-only diagnostic.
The two sampled differing URL pairs have the same host/path, REST parameter `v`
and GraphQL parameters `u,v`; neither requests an `s` image size. The additional
`u` is opaque and is neither the sampled login nor numeric account ID. Both
sampled pairs returned identical image bytes (four unauthenticated public image
GETs; no token sent to the avatar host). This is evidence for those two images,
not a universal image-equivalence guarantee or an explanation of GitHub's private
URL-generation algorithm. GitHub documents [avatarUrl and its optional size](https://docs.github.com/en/graphql/reference/users#actor),
not an equivalence contract for opaque URL parameters.

We neither strip parameters nor generate a replacement avatar URL. Verified REST
discovery preserves the existing REST string. The repeated
[historical canonical diagnostic](measurements/hybrid-compatibility-diagnostics-2026-10-31.json)
reports raw `user: 28`, but **zero compatible canonical-field differences and zero
fallbacks** across all 40 PRs. It separately retains the original raw evidence.

PR timestamps cannot detect every profile change; exact login/type/node matching
and duplicate-observation checks catch observable ambiguity, but neither API
provides an atomic cross-request snapshot. A profile avatar can change during a
refresh without changing a PR timestamp. This remains a race to assess during
future integration; no evidence is retained across refreshes.

## Reviewer compatibility and live fallback causes

Source inspection (graph lookup followed by current-source reads) found:

- `src/types.ts` defines individual reviewers as `{login, avatar_url}`.
- `PullRequestList.tsx` uses login as key/label and avatar URL, preserves order,
  displays the first ten and uses the full count.
- `usePullRequests.ts` uses reviewer count for urgency sorting. Reviewed retention
  and source membership remain the existing REST logic.
- `api.ts` filters valid reviewers but retains extra raw REST attributes.
  Encryption serializes the resulting objects without consuming extra attributes.
  Notification and hidden-state identity use numeric PR IDs, not reviewer objects.

The 17 extra REST reviewer attributes identified in #101 are therefore an
**expected compatible representation difference**, not fields needed by current
production consumers. No production mapper or stored snapshot is rewritten.
`fieldDifferences` still compares raw objects; separate consumed-field and
canonical comparisons explicitly project only the reviewer fields above. They
continue to flag changed login, avatar, count, membership and order. Nothing
normalizes avatar parameters or sorts reviewer arrays to hide a mismatch.

User reviewer nodes require nonempty login and avatar URL. Bot, Mannequin and
EnterpriseTeam reviewer representations require REST fallback until paired REST
parity is established; their GraphQL login representation is not assumed safe.
Ordinary teams require a nonempty slug and remain separate team requests, not
individual reviewer avatars. More than 100
connection nodes, continuation, null/inaccessible/unknown nodes, duplicate
individual identities or malformed results require full REST canonical fallback;
none are silently dropped. Unsupported actor fallback has deterministic coverage,
not a live parity guarantee. Bot/mannequin/team diversity and team permissions
still need broader live validation before any production rollout.

The [open canonical diagnostic](measurements/hybrid-compatibility-diagnostics-open-2026-10-31.json)
and [bounded shape diagnostic](measurements/hybrid-compatibility-shapes-open-2026-10-31.json)
explain the 22/40 open-sample fallbacks:

- 20 PRs contain 23 null requested-reviewer nodes.
- One PR contains duplicate individual reviewer logins.
- One author has a different login despite matching node ID/type. It is **not**
  the Bot `[bot]` suffix pattern. Strict matching correctly requires fallback;
  matching PR timestamps alone does not prove author freshness.

No connection has an additional page or count/length mismatch in that shape
sample. We do not infer whether null nodes represent deleted actors, inaccessible
teams, or another GitHub condition. Their ambiguity is exactly why REST fallback
is necessary. Raw open GraphQL comparisons report 13 author differences among 19
otherwise mappable PRs, plus 21 unsupported metadata results. All 22 fallback
requirements remain visible in the preserved diagnostic. After actual REST
fallback, both timed pairs have **zero raw final-PR, consumed-field and canonical
metadata differences** at 5, 20 and 40 PRs, including author avatars, reviewer
order, head SHA/base/head repository identity, IDs, state and timestamps.

## Repeated measurements

### Deterministic fixtures

[Full fixture matrix, batch and failure studies](measurements/hybrid-compatibility-fixtures-2026-10-31.json).
Three alternating paired repeats per size. Four repositories, nullable authors,
drafts, reviewed-only PRs, deleted head repositories, multiple reviewers/teams,
all five CI states, optional failures, 145 check runs and large reviewer fallback.
Both full objects and consumed/canonical metadata match on successful pairs.

These timings use **5 ms REST / 8 ms GraphQL artificial local response delays**.
They measure the Node tooling including mapping/comparison instrumentation, not
GitHub network or production-browser latency. Bytes are decoded response JSON,
not compressed wire transfer. The enriched discovery fixtures and added GraphQL
identity fields increase absolute payload sizes relative to #101.

| PRs | HTTP REST / hybrid | Core REST / hybrid | Search each | GraphQL calls / synthetic points | Hybrid fallback | Decoded bytes REST / hybrid | Median local ms REST / hybrid |
| --: | -----------------: | -----------------: | ----------: | -------------------------------: | --------------: | --------------------------: | ----------------------------: |
|   5 |            21 / 17 |            18 / 13 |           3 |                            1 / 1 |               0 |             36,779 / 16,919 |                   92.7 / 78.8 |
|  20 |            68 / 49 |            65 / 45 |           3 |                            1 / 1 |               0 |            130,270 / 50,515 |                 219.5 / 140.7 |
|  40 |           132 / 95 |           129 / 90 |           3 |                            2 / 2 |               1 |           267,975 / 124,434 |                 372.0 / 264.0 |
| 100 |          324 / 231 |          321 / 223 |           3 |                            5 / 5 |               2 |           665,822 / 299,021 |                 903.9 / 591.3 |
| 150 |          484 / 346 |          481 / 335 |           3 |                            8 / 8 |               4 |         1,005,603 / 471,263 |                1312.0 / 855.3 |

Additional CI pages in each client: 1 / 2 / 4 / 10 / 15. Legacy combined-status
calls: 1 / 2 / 4 / 10 / 15. Additional review pages: zero, preserving today's
first-page review semantics. REST core/search fixture consumption equals counted
requests; GraphQL points are synthetic telemetry, not a prediction of real cost.
At 40 PRs, request savings remain **28.0%**. Optional failures, network/HTTP 502
fallback, partial data, required detail failure, throttling and incomplete search
remain in the existing failure study. Full fallback can erase savings and adds
two failed GraphQL attempts at 40 PRs; no retry is hidden.

### Live open PRs

[Two alternating pairs per size](measurements/hybrid-compatibility-live-open-2026-10-31.json),
public `cli/cli`, the oldest currently open PRs (`is:open sort:created-asc`). These
are real open PRs, including old/ambiguous reviewer data; they are not a random
sample of GitHub or a logged-in user's default three-source dashboard. Live
100/150 workloads were not run, to limit API usage; those sizes are fixture-tested.

| Open PRs | Actual HTTP REST / hybrid | Core REST / hybrid | GraphQL calls / reported points | Hybrid fallbacks | Decoded bytes REST / hybrid | Median CLI ms REST / hybrid |
| -------: | ------------------------: | -----------------: | ------------------------------: | ---------------: | --------------------------: | --------------------------: |
|        5 |                   21 / 18 |            21 / 17 |                           1 / 1 |                1 |            107,170 / 51,438 |             1958.0 / 2213.6 |
|       20 |                   72 / 64 |            72 / 63 |                           1 / 1 |               11 |           885,149 / 767,301 |             5000.0 / 5306.5 |
|       40 |                 139 / 123 |          139 / 121 |                           2 / 2 |               22 |       1,834,107 / 1,592,810 |            9756.4 / 10150.5 |

Actual search calls **per timed trial are zero**: one discovery search captured
membership and author evidence once, replayed identically for both clients.
The artifact's `searchRequests: 1` is that counted replay, not a live API call.
Actual HTTP/bytes in this table subtract replay traffic. Twenty-six shared
preflight/discovery/budget-probe requests are recorded separately. Including one
logical search gives 22/19, 73/65, 140/124 total logical calls respectively.

Request reductions at 5/20/40 are **14.3% / 11.1% / 11.5%**; decoded-byte reductions
are **52.0% / 13.3% / 13.2%**. Median latency **regresses 13.1% / 6.1% / 4.0%**.
These are medians of two local CLI trials, not confidence intervals or browser
measurements. Both pairs independently regress at every size. Sequential upfront
batching plus canonical fallback is a plausible contributor, not a causally
isolated latency measurement.

REST core observed deltas match counts here. GraphQL reports 1 / 1 / 2 points
per trial; probe deltas are often zero despite reported cost. Some search probes
cross a budget reset (null deltas). Shared/cached budget probes are not exact
per-client cost attribution. Never add GraphQL points to REST core/search units.
There are no retries, optional HTTP errors, or extra review/CI pages in these live
trials. Legacy status calls remain 5 / 11 / 18 per client. All five CI states and
pagination/failure semantics are exercised deterministically, not claimed for
all live samples. The historical #101 40-PR sample's 23.6% request and 19.4% latency
reductions remain historical: that closed/no-CI-heavy population differs from
this open population and was measured before compatibility preservation.

### Limits and reproducibility

Public samples do not establish private/SSO/enterprise or arbitrary reviewer
parity. Fixtures cover cross-repository metadata, missing/deleted head repos,
transferred/wrong namespaces, closed/merged/draft states, null/malformed fields,
permission failures, missing aliases, partial GraphQL data, cancellation and
invalidated sessions. REST required failures still prevent a publishable partial
snapshot; auth/rate failures halt without unsafe fallback. Cooldown metadata and
session guards remain in the isolated client; manager persistence is not integrated.
No private credentials or repository content is committed.

```powershell
# No credentials or network in fixture mode:
node scripts/measure-hybrid-metadata.mjs
# Explicit read-only public opt-in, token read from gh into memory only:
$env:PR_TRACKER_HYBRID_LIVE = '1'
$env:PR_TRACKER_HYBRID_LIVE_SIZES = '5,20,40'
node scripts/measure-hybrid-metadata.mjs --live --open
node scripts/measure-hybrid-metadata.mjs --live --diagnose
node scripts/measure-hybrid-metadata.mjs --live --diagnose --open
```

Each build clears `.output/hybrid-measurement`; copy aggregate files before the
next invocation. The shape/avatar checks were separate bounded diagnostics, not
included in timed trial totals. Shape snapshots used two public API calls each;
image checks used four public image GETs. Diagnostic artifacts record their own
calls and points. All measurements here used Node 22.14.0 / Windows x64; Node 24
and production-browser hybrid performance are unmeasured.

## Readiness and smallest next step

**NO-GO for connecting this default candidate yet**, including a default-off
production integration. Correctness is materially improved and safe fallbacks
prevent omission, but repeated open measurements do not demonstrate meaningful
overall latency benefit and small lists regress. Missing the 25% request target
alone is not decisive: latency, transfer, compatibility and complexity together
support this decision. Do not loosen null/duplicate/freshness guards to meet it.

Before reconsidering, investigate GitHub's null/duplicate review-request behaviour
and a bounded compatible fallback/scheduling strategy, then repeat active/open,
reviewer-diverse and safely available private/SSO samples with the same accounting.
Require consumed metadata parity, no omitted PRs, safe throttle/session handling,
meaningful repeated overall gains and acceptable 5-PR latency. Keep REST in place
until those criteria are met; this PR does not promise that any query fixes them.

If subsequent evidence supports integration, the smallest separate PR would
inject a canonical metadata provider after unchanged REST discovery. Use a
default-off feature flag and staged rollout; keep REST reviews/CI untouched. Add
manager-level cooldown, cancellation, encrypted-cache and notification comparison
integration tests. Roll back by selecting REST and invalidating the in-flight
session generation. Numeric PR IDs and the existing encrypted payload shape stay
compatible, so no cache rewrite, reset or reinstall is needed.

## Verification

TypeScript, Oxlint, all 655 unit tests (32 files), 52 headed and 52 headless Chrome
E2E tests (9 files each, including CI layout/light/dark/Reviewed), Chrome MV3 and
Firefox MV2 production builds pass. Changed-file Prettier and scoped Git diff
checks pass. Build scans find no experimental query/error/fixture markers. Firefox
runtime and hybrid browser integration were not tested; Firefox is build-verified.
The baseline was 612 passing unit tests; 43 focused cases were added. No production
fetching, status reducer, UI, permissions, encryption or version files changed.
