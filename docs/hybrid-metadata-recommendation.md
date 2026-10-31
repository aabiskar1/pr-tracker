# Hybrid metadata batching: recommendation and evidence

> Historical PR #101 evidence. See the [compatibility follow-up](hybrid-metadata-compatibility.md)
> for verified REST author preservation, explicit reviewer compatibility and repeated
> open-PR measurements. The production pipeline remains REST.

**NO-GO for production integration at this point. Keep REST enabled.** The
isolated candidate reduces requests and payload and improves measured fetcher
latency, but exact live metadata equivalence is not established. The mixed
40-PR fixture clears the 25% request target; the no-CI-heavy public history
sample does not. No production fetcher, UI, permission, storage format,
notification, authentication, dependency or version was changed.

This follows [PR #99](https://github.com/aabiskar1/pr-tracker/pull/99) and retains
[PR #100](https://github.com/aabiskar1/pr-tracker/pull/100). Both were merged at
base `e2ee3e8`. PR #99's six documents/artifact, experimental client, measurement
transport, runner and paired tests were reviewed. Its historical full-GraphQL
97-PR result (311 vs 3 requests, 2,801,570 vs 53,769 bytes, 18.70 vs 2.49 s)
changed review/CI behaviour. It is not a hybrid baseline. Its 216-vs-311 hybrid
estimate was analytical, assumed two batches and 18 legacy fallbacks, and was
never a performance guarantee. See [the earlier recommendation](graphql-recommendation.md).

## Architecture and isolation

Current: REST `/user` -> three unchanged REST search streams (or custom query)
-> deduplicate -> four PR work units, each canonical REST detail followed by
parallel REST reviews and CI. CI uses 100-run pages, at most 1,000 runs, and the
combined-status aggregate only after confirmed zero checks. All five CI states,
including invisible No CI, remain untouched. Reviews intentionally retain the
existing default first page and latest-returned-review-per-user reduction.

Candidate: the same REST identity/discovery -> deduplicate -> sequential GraphQL
canonical-metadata batches -> the same four-worker REST reviews/CI operations.
In tooling only, `createHybridTransport` observes completed REST discovery and
answers canonical-detail lookups from an isolated metadata result. Its first
hydration promise is shared by the four workers; all batches complete before
optional work starts. Synthetic detail responses are **not** counted as network
requests; actual GraphQL and REST fallback calls are counted. No production
module imports the experiment. The wrapper is an evaluation seam, not a proposed
production global-fetch interception or a storage/cache layer.

The implementation reuses PR #99's `instrumentTransport`, native fetch, Vite
browser-boundary runner pattern and existing dependencies. The real, current
`fetchPullRequests` executes in both trials. Discovery union, ordering, reviewed
retention, closed default-hit removal, custom queries, CI and review reducers
are therefore not reimplemented in the benchmark. The source fetcher is unchanged.

## Batching, completeness and fallback

- Default 20 PRs/query; configurable integer 1-50, maximum 3,000 unique targets
  (the existing three-search discovery bound). Queries are sequential and contain
  variable-only repository/PR aliases. REST discovery already supplies canonical
  owner/repository/number URLs; the shared TypeScript search type does not require
  node IDs. Aliases avoid an extra identity-resolution request and an assumption
  that all discovery records contain a valid GraphQL node ID. A future nodes-based
  variant could reuse verified `node_id` values, but is not needed here.
- Each PR requests at most 100 review-request nodes. A 20-PR batch selects at most
  2,000 such nodes, or 5,000 at the configurable maximum. These are shape bounds,
  not measured point costs or timeout guarantees. Additional repository/PR nodes
  are small but still count toward GitHub's resource limits. No unbounded nesting.
- `hasNextPage`, counts, null/unknown reviewer actors, duplicate individual
  reviewers, unsafe numeric IDs, missing SHA/base metadata, transferred namespaces
  and malformed nodes require REST canonical fallback. Large reviewer connections
  use one REST detail call instead of an additional GraphQL pagination algorithm;
  they are never silently truncated. Team nodes are not individual avatars.
- Alias-scoped partial errors isolate that PR; unscoped/unrecognized paths and
  unusable envelopes require fallback for the batch. Network failures, invalid
  JSON, HTTP 5xx and resource errors also permit one REST fallback per PR, with
  no immediate GraphQL retry or sleep. A failed required fallback makes the
  production fetcher return failure, never a publishable partial snapshot.
- HTTP 401/403 or GraphQL FORBIDDEN/UNAUTHORIZED halt the operation. GraphQL
  RATE_LIMITED (including HTTP 200), primary/secondary HTTP limits, and exhausted
  telemetry halt later batches without REST fallback. The typed error carries
  sanitized classification/cooldown metadata. Existing cooldown derivation is
  reused, with the HTTP-200 primary classification corrected in this experiment.
  Missing/unusable deadlines still halt safely rather than inventing success.
- The session signal and generation predicate are checked before each query,
  after fetch/body consumption, before returning metadata and around REST
  fallback. Abort/invalidation propagates, with no later batch or fallback.
  Tooling preserves the cooldown in its failed result; persistence in the real
  manager remains a future integration requirement, not an implemented guarantee.

Relevant contracts: [PR metadata and reviewer unions](https://docs.github.com/en/graphql/reference/pulls),
[GraphQL budgets, node limits and timeouts](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).
REST core, REST search and GraphQL primary budgets are reported separately;
shared secondary limits mean fallback after throttling is unsafe. Cost must be
read from the server, not inferred from the number of aliases.

For an analytical request model, let `S` be REST search pages, `N` distinct
canonical PRs, `B` GraphQL batches, `F` combined-status calls, `P` additional
supporting pages and `R` REST canonical fallbacks. Current REST uses
`1 + S + 3N + F + P`; hybrid uses `1 + S + B + 2N + F + P + R`. Savings are
`N - B - R`, not a promise about time or points. Reusing #99's historical
`N=97, S=1, F=18` with this prototype's default 20-item batches gives **219 vs
311** analytically, assuming no extra pages/fallbacks. The old **216** estimate
assumed 50-item batches; neither is a new measurement of that historic workload.
With universal legacy fallback, even one metadata batch saves less than 25% at
40 PRs once identity/discovery overhead is included. That workload dependence
must not be hidden by omitting CI calls from the denominator.

## Deterministic fixture measurements

[Full trials, batch study and failure study](measurements/hybrid-fixtures-2026-10-31.json).
Five workload sizes, three paired repeats in alternating order, fixed synthetic
metadata over four repositories, drafts, source overlap and reviewed-only PRs,
multiple individual reviewers and teams, deleted head repositories, nullable
authors, review supersession/default-page edge cases, all five CI states, optional
403s, 145-run CI pagination and >100-reviewer REST fallback. Identity and all three
REST discovery searches are included. There are no live requests or credentials.

Timing deliberately adds **5 ms per REST response and 8 ms per GraphQL response**
locally, then measures actual wall time including instrumentation/mapping. These
are synthetic-delay fetcher measurements, **not GitHub network latency**, browser
refresh performance, or a prediction of a universal speedup. Counts, payloads
and equivalence are deterministic; timer scheduling/JIT makes elapsed time vary.
REST fixture bodies include plausible unused description/link/repository data;
byte savings depend on those synthetic shapes. HTTP counts are explicit fetch invocations; redirects or retries inside the network stack are not separately observed. Bytes are decoded JSON, not
compressed wire transfer. Environment was Node 22.14.0 / Windows x64, not the
project's Node 24 target or a browser service worker.

| Hydrated PRs | HTTP REST / hybrid | Request reduction | Decoded bytes REST / hybrid | Byte reduction | Median local ms REST / hybrid | Local latency reduction |
| -----------: | -----------------: | ----------------: | --------------------------: | -------------: | ----------------------------: | ----------------------: |
|            5 |            21 / 17 |             19.0% |             35,596 / 15,371 |          56.8% |                   94.1 / 78.2 |                   16.8% |
|           20 |            68 / 49 |             27.9% |            125,611 / 44,437 |          64.6% |                 219.0 / 139.1 |                   36.5% |
|       **40** |       **132 / 95** |         **28.0%** |       **258,657 / 112,321** |      **56.6%** |             **373.3 / 264.1** |               **29.3%** |
|          100 |          324 / 231 |             28.7% |           642,865 / 269,036 |          58.2% |                 907.2 / 592.6 |                   34.7% |
|          150 |          484 / 346 |             28.5% |           971,421 / 426,511 |          56.1% |               1,326.2 / 878.7 |                   33.7% |

| PRs | REST core calls / hybrid core calls | REST search calls each | Hybrid GraphQL calls | REST canonical fallbacks in hybrid | Extra CI pages each | Legacy status fallback calls each |
| --: | ----------------------------------: | ---------------------: | -------------------: | ---------------------------------: | ------------------: | --------------------------------: |
|   5 |                             18 / 13 |                      3 |                    1 |                                  0 |                   1 |                                 1 |
|  20 |                             65 / 45 |                      3 |                    1 |                                  0 |                   2 |                                 2 |
|  40 |                            129 / 90 |                      3 |                    2 |                                  1 |                   4 |                                 4 |
| 100 |                           321 / 223 |                      3 |                    5 |                                  2 |                  10 |                                10 |
| 150 |                           481 / 335 |                      3 |                    8 |                                  4 |                  15 |                                15 |

In fixtures, consumed REST core/search units equal counted requests. GraphQL
fixture telemetry reports **1 synthetic point/batch** (1, 1, 2, 5, 8); this tests
accounting only and is not a GitHub point-cost estimate. Do not add those points
to REST request units. Additional review-history pagination is zero in both
clients, preserving today's first-page semantics. Eight intentional optional
403 responses in the 40-PR workload occur in both clients, yielding the same
Pending review/Unknown CI and no retry. All paired successful fixture PR objects
match exactly, including sources/order and status labels. Metadata fallback is
included in every count and payload total.

For 40 PRs, batch sizes 10 / 20 / 40 / 50 used 4 / 2 / 1 / 1 GraphQL calls and
97 / 95 / 94 / 94 total requests. Single local hybrid timings were 297.1 / 263.8 / 249.4 / 249.2 ms; this small study does not establish real query cost/latency at
larger batch sizes. Default 20 keeps queries modest for one extra request versus
40/50. The 5-PR local case improved, but small live/open workloads are unmeasured.

### Failure study (40 PRs, no artificial delay)

| Fault                     | REST / hybrid result | HTTP REST / hybrid | Hybrid REST canonical fallbacks | Interpretation                                                                       |
| ------------------------- | -------------------- | -----------------: | ------------------------------: | ------------------------------------------------------------------------------------ |
| Alias-scoped partial data | success / success    |           132 / 97 |                               3 | Two affected aliases plus the large-reviewer fallback; equal final objects           |
| GraphQL network failure   | success / success    |          132 / 134 |                              40 | All metadata falls back; two failed GraphQL attempts are counted; point cost unknown |
| GraphQL timeout/HTTP 502  | success / success    |          132 / 134 |                              40 | Fallback erases savings and adds overhead; no GraphQL retry                          |
| GraphQL rate limit        | success / failure    |            132 / 5 |                               0 | Conservative failed refresh/cooldown rather than bypassing a limit                   |
| REST detail unavailable   | failure / failure    |            44 / 93 |                               1 | Different API availability changes work before failure; neither publishes data       |
| Incomplete REST search    | failure / failure    |              4 / 4 |                               0 | No metadata hydration or supporting requests start                                   |

The required-detail availability case intentionally makes REST details fail while
GraphQL metadata survives. More supporting work can occur before the hybrid's
large-reviewer fallback fails. This is a reliability/efficiency risk, not an
output-parity success or a comparable successful-latency sample. No retry count
is hidden. Endpoints in JSON count completed responses; top-level requests also
include failed transport attempts. Production has no new failure path because
this implementation is unconnected.

## Live 40-PR evidence and uncertainty

[Paired live trials](measurements/hybrid-live-2026-10-31.json) use the first 40
historical PRs in public `cli/cli`, two paired repetitions with alternating order.
REST discovery membership was captured once and replayed to both clients so
search drift could not change the identities. Identity, metadata and existing
REST reviews/CI are live; replayed discovery is **not** an actual HTTP call.
This is a public fixed-membership fetcher comparison, not a live default-dashboard
or browser benchmark. In the artifact `totalHttpRequests` includes the logical
replayed search, while `actualHttpRequests` excludes it. Actual decoded bytes
likewise exclude the replayed body.

| Actual live metric                   |         REST |       Hybrid |
| ------------------------------------ | -----------: | -----------: |
| HTTP requests per trial              |          161 |          123 |
| REST core requests                   |          161 |          121 |
| Live search requests per trial       |            0 |            0 |
| GraphQL requests                     |            0 |            2 |
| Server-reported GraphQL points       |            0 |            2 |
| Actual decoded body bytes            |      943,958 |      355,101 |
| Fetcher latency, pair 1              |   8,837.6 ms |   7,001.9 ms |
| Fetcher latency, pair 2              |   8,700.8 ms |   7,132.7 ms |
| Median fetcher latency               |   8,769.2 ms |   7,067.3 ms |
| REST canonical fallbacks             |            0 |            0 |
| Reviews / checks / combined statuses | 40 / 40 / 40 | 40 / 40 / 40 |

Requests fell **23.6%**, decoded bytes **62.4%**, median latency **19.4%**.
There were no extra CI or review pages, automatic retries, HTTP errors or failed
transports. This historical workload's universal legacy-status fallback reduces
the fraction of calls that metadata batching can save; it misses the 25% request
threshold. Two pairs cannot establish tail latency or isolate caching, connection reuse, server load or changing metadata. No
live private/SSO/default-dashboard or large-reviewer validation was performed.

GraphQL costs were 1 point/query in these **specific** observed batches. Budget
probes disagreed: GraphQL used-deltas stayed zero despite reported costs, one REST
core delta was 162 for 161 calls, and one search delta advanced by 3 despite no
live search in that trial. These shared/stale budget anomalies are retained in
the artifact; subtraction is not exact per-client billing. Reported query cost
and counted REST resources remain separate. Ten discovery/budget overhead calls
are excluded from trial timing/bytes/counts. Two further 44-call metadata-only
diagnostics (88 calls including their probes) explain the field mismatches;
only the final expanded diagnostic is committed. Total live study traffic was
666 HTTP calls, including this disclosed overhead. No PR content, user identities
or credentials are saved in artifacts.

## Canonical mapping and every observed difference

[Aggregate field diagnostic](measurements/hybrid-diagnostics-2026-10-31.json).
Direct fixture mapping and the live canonical projection compare all of the
following, not only the fields persisted in the popup PR type:

| Canonical input                                         | Mapping / compatibility evidence                                                                                                                                                                                                                                      | Classification                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, PR number, repository owner/name                  | `fullDatabaseId` -> safe numeric REST ID; aliases use PR number only for lookup. Opaque GraphQL IDs never replace numeric hidden/notification keys. Unsafe/missing IDs fall back.                                                                                     | Resolved through mapping; live numeric identities match                                                                                                                |
| Title, canonical URL, draft, created/updated timestamps | Preserve strings; no silent timestamp reformatting. Updated time is retrieved even though current popup mapping drops it.                                                                                                                                             | Resolved for fixtures/live sample; spelling variants remain explicit test differences                                                                                  |
| Open/merged/closed                                      | OPEN -> open; CLOSED/MERGED -> closed, with merged flag retained in canonical detail. Existing default filtering/custom-query handling runs unchanged.                                                                                                                | Resolved through mapping                                                                                                                                               |
| Base repository and current head                        | Reconstruct REST API repository URL from validated base namespace; use `headRefOid`, not a branch-tip/rollup. Head repository may be null after deletion. CI stays on base repository/current SHA, including forks and later commits.                                 | Resolved in fixtures and live canonical comparison                                                                                                                     |
| Null/missing/inaccessible metadata                      | Null author allowed; missing required head/base/node or unknown reviewer requires fallback; permission errors halt. Transfer/deletion fallback failures remain required failures.                                                                                     | Safe fallback strategy; private/SSO live validation still missing                                                                                                      |
| Individual requested reviewers and teams                | Preserve returned individual order/login/avatar; Team/EnterpriseTeam are not individual reviewers. Team slugs are retained where selected, outside the current UI type. Truncated connections fall back.                                                              | Resolved common mapping; cross-API order guarantees remain unproven                                                                                                    |
| Author avatar URLs                                      | Both live pairs differ in 28 author objects. All 28 URLs have the same host/path; the diagnostic found opaque `u`/`v` parameters. Other projected user fields match. URLs are preserved exactly as returned, never stripped/rewritten.                                | **Unresolved exact-equivalence blocker**; visual equivalence was not proven                                                                                            |
| Raw requested-reviewer objects                          | Both full-result live comparisons differ for one PR. Diagnostic login/avatar/order/membership all match. REST passes 17 additional user attributes through its filter; GraphQL supplies only the typed consumed fields. Fixture test keeps this raw mismatch visible. | Expected difference with a compatibility strategy: consumer projection may be approved/tested, or use REST fallback for affected PRs. No production mapper was changed |
| Review and CI labels                                    | Same REST endpoints/reducers, including default review page, paginated checks, Unknown and invisible No CI. No rollup/summary replacement exists in the query.                                                                                                        | Resolved in fixture pairs; live labels match                                                                                                                           |

Do not normalize opaque avatar URLs or drop raw fields in comparisons to claim
exact parity. The diagnostic deliberately reports **both** full-result mismatches
and a typed canonical projection, explaining the difference instead of hiding it.
The live dataset has little requested-reviewer diversity. Teams, bots, mannequins,
large connections, order changes and null actors are covered by fixtures/policy,
not established as universally equivalent GitHub behaviour.

## Decision and smallest safe follow-up

**NO-GO for wiring this candidate into production now.** Fixture evidence clears
the 40-PR request target and live fetcher latency/payload improve, but exact avatar
parity fails, raw reviewer compatibility needs an explicit decision, and a second
representative live workload that clears 25% is missing. Storage/notification/UI
integration and private/SSO/session-cooldown persistence have not been proved by
an unconnected transport experiment. Production REST remains the fallback plan.

The next focused PR should first resolve canonical author/reviewer compatibility
without blindly stripping URL parameters. Explore verified author data already
present in REST discovery, with strict identity checks and fallback when stale or
ambiguous; measure its actual parity/cost. Add public/private/open and reviewer-heavy
paired samples, Node 24 and browser fetcher measurements. If equivalent outputs
and the performance threshold hold, a later integration PR can inject a metadata
provider at the canonical hydration boundary, reuse the existing search/optional
logic, and add manager/session/encrypted-cache/notification E2E coverage. Avoid
tooling's global-fetch wrapper in production. Gate any such integration behind a
default-off feature flag/staged rollout with an immediate REST-only switch.

Rollback must select REST canonical hydration and discard in-flight GraphQL work
through the existing session generation guard. It must retain numeric IDs and the
same encrypted PR/preference shape; no cache rewrite or reset is needed. Do not
fall back through REST after shared throttling. A failed required batch/fallback
must leave the last-successful snapshot and notification comparison untouched.

## Reproduction and validation

```powershell
node scripts/measure-hybrid-metadata.mjs
# Explicit read-only opt-in; CLI credential stays in memory:
$env:PR_TRACKER_HYBRID_LIVE = '1'
node scripts/measure-hybrid-metadata.mjs --live
node scripts/measure-hybrid-metadata.mjs --live --diagnose
# Optional supported live sizes: 5,20,40,100,150 (budget guard applies):
$env:PR_TRACKER_HYBRID_LIVE_SIZES = '5,20,40,100,150'
```

The runner writes aggregate JSON under ignored `.output/hybrid-measurement/`.
Building a runner clears that output directory; copy reviewed aggregates before
running the next mode. Live mode defaults to 40 PRs/two pairs; tests never enable
it or read credentials. Artifacts above are aggregate-only reviewed copies.

The latest-main unit baseline had **29 failures / 533 tests** in old PR #99
comparisons after #100 changed CI URLs and response validation. This PR updates
those REST fixtures to `per_page=100&page=1`, valid counts/run IDs and valid legacy
status contexts. Original review/CI mismatch assertions and request counts remain;
no test was skipped, weakened or deleted. The production fetcher was not changed.

Final verification: TypeScript compilation, Oxlint, the full unit suite, all 52 headed and all 52 headless Chrome E2E tests (including layout/theme/Reviewed), Chrome/Firefox production builds, changed-file Prettier and Git diff checks passed. Production build scans found no hybrid query, error or fixture markers. Exact final unit totals are recorded in the PR description. Runtime browser
coverage remains Chrome MV3; Firefox MV2 is production-build verified only.
The existing layout/theme/Reviewed tests exercise production, not a claim that
hybrid manager/storage integration already exists. Production output must contain
neither `TrackerHybridMetadata` nor the fixture token/organization markers.
