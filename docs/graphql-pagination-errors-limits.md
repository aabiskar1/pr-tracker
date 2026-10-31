# REST versus GraphQL: pagination, failures and limits

This compares PR Tracker's current implementation with the isolated GraphQL
PoC. API capabilities and current client behaviour are distinguished below.
No live rate limits, timeouts or permission failures were deliberately induced.
Live measurements are [reported separately](graphql-live-measurements.md).

## Pagination and completeness

| Concern                  | Current REST path                                                                                                            | GraphQL PoC                                                                                                 | Migration consequence                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Search page addressing   | Numeric `page`, `per_page=100`                                                                                               | `after` cursor, `first=50`, `pageInfo`                                                                      | Cursor state belongs to each search; it cannot be shared across sources.                                                |
| Default discovery        | Three query streams run concurrently; pages in each stream are sequential                                                    | All streams/pages sequential                                                                                | Fewer total calls can still leave a longer search critical path, especially for small accounts.                         |
| Search ceiling           | 1,000 items per query; up to ten pages                                                                                       | Same ceiling; up to twenty pages, with explicit `truncated` flag                                            | GraphQL search does not remove the cap. Three disjoint default searches can each reach it.                              |
| Empty search             | One request per stream                                                                                                       | One request per stream                                                                                      | A refresh still pays discovery overhead when no PR is returned.                                                         |
| Required-page validation | Checks count, page shape and `incomplete_results`; rejects premature short pages and malformed/failed pages                  | Checks count, cursor progression, nonempty continuation, node shape and GraphQL errors                      | Both reject known incomplete discovery; they use different signals.                                                     |
| Duplicate hits           | Deduplicates URLs after collecting searches; merges source annotations                                                       | Rejects duplicate numeric identities within one search; merges source annotations across searches           | The stricter PoC can fail on overlap between changing pages that REST would deduplicate.                                |
| Supporting data          | Reviews/check-runs use REST defaults: first 30; no traversal. Canonical requested-reviewer list is not separately paginated. | Review requests fetch at most 100 per PR; another page rejects the refresh. Review/CI use scalar summaries. | Implement independent nested pagination or a validated fallback; fetching more history is not automatically equivalent. |
| Dataset changes          | Initial reported count sets capped target                                                                                    | Initial reported count sets capped target                                                                   | Neither guarantees a stable snapshot or detects all missing/replaced items during mutation.                             |

GitHub documents [REST search's cap and incomplete results](https://docs.github.com/en/rest/search/search),
the [GraphQL search ceiling](https://docs.github.com/en/graphql/reference/search),
and [cursor pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api).
Every GraphQL connection needs a 1–100 `first`/`last` size. Completing a search
page does not complete each PR's reviewer/review/check connections. Continuations
for a particular PR require its stable node/repository identity and own cursor;
continuing the search cursor cannot retrieve that PR's remaining children.

The PoC has no REST `incomplete_results` equivalent. It inspects GraphQL errors,
nulls, counts and cursors, but a consistent count without errors is not proof
of full discovery. Its count checks are also stricter than REST when later pages
overrun the initially reported target. Search reordering or concurrent updates
therefore need explicit parity tests before adopting its rejection policy.
At the per-query ceiling, three full default searches use thirty REST search
pages versus sixty PoC GraphQL pages. These are source-derived page counts,
not live measurements. REST deduplicates before canonical/supporting fetches;
GraphQL has already returned selected PR metadata for each overlapping search
before deduplication, so overlap can repeat payload and nested-query work.

## Error handling and refresh outcomes

| Failure                                | Current REST behaviour                                                            | GraphQL PoC / remaining work                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Identity/search/canonical detail fails | Refresh fails before success effects; cached snapshot retained                    | Rejects operation; no manager/storage wiring exists to prove equivalent side effects.                                               |
| Review/check/status fails              | Supporting label becomes pending; complete discovery can still succeed            | Any GraphQL error rejects the whole operation, including optional-field errors with usable data. This changes behaviour.            |
| HTTP 401 or ordinary 403               | Shared classifier distinguishes auth/forbidden feedback                           | Throws with original Response; no authentication/permission classification or popup notification adapter.                           |
| HTTP 403/429 rate limit                | Recognized valid cooldown is propagated/persisted; later refreshes are suppressed | Response and headers retained, but no cooldown derivation/persistence or pre-request gate is integrated.                            |
| HTTP 200 with `errors`                 | REST success bodies are parsed as endpoint data                                   | Rejected even if `data` exists. HTTP status alone is insufficient for GraphQL success.                                              |
| GraphQL partial data/null propagation  | Separate REST requests isolate optional failures                                  | Must inspect error type/path and surviving required fields, or split optional queries; null is not necessarily an empty connection. |
| Invalid JSON/network exception         | Required path fails; optional endpoints degrade to pending                        | Propagates rejection without returning partial results.                                                                             |
| Timeout/resource exhaustion            | Required versus optional endpoint determines outcome                              | Query may fail with HTTP error or partial data/errors; avoid publishing a partial PR list or treating the query as free.            |
| Session invalidation                   | Abort signal plus session-generation guards protect subsequent side effects       | Signal checked around fetch/JSON work; generation/storage integration remains unimplemented.                                        |

The REST cooldown helper prefers valid `Retry-After`, then reset time when
remaining quota is zero, then a one-minute fallback for secondary/generic limits.
A recognized primary limit with an unusable deadline can be reported without a
persistable cooldown. Neither client immediately retries or sleeps in an active
refresh. Existing persisted cooldown/alarm handling is suitable for later
GraphQL integration; do not lose it by swapping transport functions alone.

GraphQL primary limits can arrive as HTTP 200. The existing HTTP classifier can
recognize a human-readable rate-limit message and derive its reset deadline,
but its primary classification specifically checks 403/429. The new protocol
fixture consequently observes `generic` for a 200 exhausted-quota response.
It does not parse GraphQL error types or paths; relying on message matching
alone is not a complete adapter. The retained Response permits future handling,
but does not itself enforce cooldowns.

[`graphql-protocol.unit.test.ts`](../tests/unit/graphql-protocol.unit.test.ts)
also demonstrates that REST succeeds with pending review after an optional 403,
whereas a GraphQL 200 partial response with an error scoped to review state
rejects. These are explicit compatibility gaps, not proposed behaviour changes.

## API budgets and resource ceilings

For ordinary authenticated-user access, documented primary ceilings are 5,000
REST requests/hour and a separate 5,000 GraphQL points/hour. REST issue/PR search
has its own authenticated 30-request/minute budget. Authentication method and
enterprise context can change primary ceilings; use response metadata rather
than hard-coding an account allowance. Sources:
[REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
[search limits](https://docs.github.com/en/rest/search/search#rate-limit),
[GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

| Constraint                 | REST                                                 | GraphQL                                                                                            | Implication                                                                                                    |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Primary accounting         | Core and search resource consumption                 | Query points based on shape; returned `rateLimit.cost`                                             | One HTTP query need not equal one primary point. Actual samples reported one point/page, not a universal cost. |
| Concurrent requests        | Shared maximum of 100 across REST + GraphQL          | Same shared constraint                                                                             | Current REST caps detail/supporting work at eight; the PoC uses one. Hybrid work must share a bound.           |
| Secondary endpoint budgets | Generally 900 points/minute                          | 2,000 points/minute                                                                                | These are distinct from primary accounting; fewer requests do not guarantee freedom from throttling.           |
| Secondary query charge     | Most read requests cost one secondary point          | Non-mutation queries cost one secondary point                                                      | Documented policy, not directly measured secondary consumption.                                                |
| Resource envelope          | Endpoint-specific timeouts; search can be incomplete | Up to 500,000 requested nodes, required connection bounds, currently ten-second processing timeout | Deep/wide nesting can offset batching gains; timeouts may incur extra primary points.                          |

These published secondary/resource limits are subject to change and include
CPU/other undisclosed constraints; see [GitHub's limit specification](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).
Respect Retry-After/reset instructions for both APIs. Switching to REST after a
GraphQL throttle can worsen a shared secondary limit, so blind fallback/retry is
not a safe migration strategy.

The live report contains server-reported GraphQL query points and observed
REST resource deltas. It also records inconsistent shared-budget snapshots,
which cannot establish exact per-client usage by subtraction. Do not compare
the fixture's hard-coded telemetry or a naive primary-point formula with those
observations as if they were measured costs.

## Decision and evidence

Existing deterministic tests cover REST search pagination/caps/incomplete pages,
HTTP classification and persisted cooldowns; GraphQL tests cover cursor
continuation, repeated/missing cursors, caps, nested truncation, partial errors,
HTTP failures and cancellation. The new paired error fixtures clarify the two
specific adapter gaps above. None of these tests consumes live credentials.

A migration must retain the existing required/optional outcomes, source union,
cache/notification/session guards and cooldown lifecycle. It needs explicit
nested-connection policy and GraphQL error classification before production
wiring. GraphQL's smaller measured request footprint does not make pagination,
error handling or limits behaviour equivalent automatically.
