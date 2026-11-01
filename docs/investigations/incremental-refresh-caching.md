# Incremental refresh and REST caching investigation

**Decision: GO for a small, volatile, canonical-detail ETag experiment; NO-GO for
skipping review/CI requests from `updated_at` or SHA, and NO-GO for persistent
response caching in this PR.** Production behavior, storage formats, extension
permissions, UI, dependencies and GraphQL integration remain unchanged. This
report starts from `main` after merged PR #104 (`60eccc1`).

## Evidence and limits

- Code inspection: [`api.ts`](../../src/background/api.ts),
  [`prManager.ts`](../../src/background/prManager.ts),
  [`githubRateLimit.ts`](../../src/background/githubRateLimit.ts),
  [`refreshSession.ts`](../../src/background/refreshSession.ts), and
  [`secureStorage.ts`](../../src/services/secureStorage.ts), plus the
  [architecture](../architecture.md), [testing](../testing.md), and prior
  [hybrid REST/GraphQL comparison](../hybrid-metadata-recommendation.md).
- GitHub contracts: [conditional requests and authenticated 304 charging](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests),
  [primary/secondary limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
  [review chronology](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request),
  [timeline event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types),
  and [timeline retrieval](https://docs.github.com/en/rest/issues/timeline#list-timeline-events-for-an-issue).
- One **unauthenticated**, read-only public probe on 2026-11-01 used PR
  `aabiskar1/pr-tracker#104` and its head SHA. No PAT, private response or
  account identifier was saved. It is endpoint evidence, not a representative
  live latency benchmark. Authorized behavior and private-repository cache
  variation were **not** tested.
- [`measure-incremental-refresh.mjs`](../../scripts/measure-incremental-refresh.mjs)
  is a deterministic endpoint simulator, **not** an invocation of the
  production fetcher. Its exact fixture sizes, virtual delays, cache assumptions
  and assertions are stated below. All performance numbers from it are
  synthetic, not measured GitHub improvements.

## Current REST request budget

The background validates `/user` on every accepted refresh. Default discovery
runs three concurrent open-PR searches (authored, requested, reviewed), each
sequentially paged at 100 with a 1,000-result ceiling; a custom query uses one
search stream. Duplicate canonical PR URLs collapse before at most four
concurrent per-PR work units. Each work unit **must** fetch and validate
canonical detail before reviews and checks run in parallel. Reviews use
validated Link pagination at 100 reviews/page, up to ten pages; checks use
`total_count` at 100/page, up to ten. Only zero check runs trigger a combined
commit-status request. A required failure preserves the last-known-good
encrypted snapshot. Optional review/CI failures become Pending/Unknown;
recognized rate limits still enter cooldown. Session abort/generation checks
prevent late requests and writes. Badge and notification decisions follow the
complete persisted result, not raw search hits.

For `N` distinct discovered PRs, `S` search pages, `R` review pages, `C`
check-run pages and `F` zero-check-run status fallbacks:

`requests = 1 + S + N + R + C + F`.

The common one-page case is `1 + S + 3N + F`; extra review/check pages add to
that. Core and search have separate primary rate-limit resources. HTTP count is
not itself the authenticated primary cost of successful 304s.

## Endpoint feasibility

The public probe made one 200 GET per endpoint and one `If-None-Match` GET only
where an ETag was present. The detail endpoint also received one
`If-Modified-Since` GET. Body bytes are decoded UTF-8 response bodies, not
compressed wire bytes or response headers. Elapsed times were one-off local
network observations and are deliberately excluded from the benchmark table.

| Endpoint               | Public probe        | Validator / conditional result                                                  | Cache feasibility and caveat                                                                                                                                                                                  |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/user`                | 401                 | No useful validator without authentication                                      | Authenticated validator behavior unknown; `/user` also enforces current identity and token validity. Do not skip it from an old login.                                                                        |
| Issue search           | 200, 3,594 bytes    | No ETag or Last-Modified on sampled `per_page=1` search                         | Keep all default/custom search pages live. Indexing and membership changes make TTL or PR-detail inference unsafe. A different authenticated search response may differ; test before any conditional rollout. |
| Canonical PR detail    | 200, 18,290 bytes   | ETag and Last-Modified; matching ETag and `If-Modified-Since` each returned 304 | Strongest first candidate. A 304 needs the exact previously validated body; it does **not** license skipping reviews or CI.                                                                                   |
| Review list            | 200, 2 bytes (`[]`) | ETag, no Last-Modified; matching ETag returned 304                              | Useful in principle **per exact page URL**, but this PR had zero reviews, so dismissal/page-boundary behavior remains unverified live.                                                                        |
| Check runs             | 200, 3,089 bytes    | ETag, no Last-Modified; matching ETag returned 304                              | Key must include repository, SHA, `per_page`, page and implicit filters; same SHA can acquire or update check runs.                                                                                           |
| Combined commit status | 200, 4,775 bytes    | ETag, no Last-Modified; matching ETag returned 304                              | Revalidate when checks are confirmed empty, even if SHA is stable.                                                                                                                                            |

The unauthenticated core `x-ratelimit-remaining` decreased on each observed
304 (detail 57→56, reviews 55→54, checks 53→52, status 51→50; the later
`If-Modified-Since` detail 304 left 49). Thus **do not claim 304 is free**.
GitHub [documents](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)
zero _primary_ charge only for a correctly authorized conditional 304. That
authenticated behavior was not measured here. A 304 still sends an HTTP
request, can consume secondary-limit capacity (most REST GETs have one point;
some endpoint costs are undisclosed), and can fail. Rate headers are the
authority; a single public sample does not establish universal validator
availability or latency. A 304 response has no JSON body and cannot be passed
through current `response.ok`/`json()` paths unchanged.

## Correctness and invalidation

| Change                                                          | Safe signal / required behavior                                                                                                                                                                                                                                                                                                              | Unsafe shortcut                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Title, base/head metadata, requested reviewers, draft/ready     | Fetch or conditionally revalidate canonical detail; keep live discovery for membership.                                                                                                                                                                                                                                                      | Reusing detail from search result or a stale local snapshot.                                              |
| New approval, change request, dismissal, or comment-only review | Revalidate the complete bounded review-page chain; aggregate once across the resulting validated history.                                                                                                                                                                                                                                    | Assuming unchanged PR `updated_at`, head SHA or first review page means unchanged effective review state. |
| New commit                                                      | Fresh detail establishes the new SHA; fetch checks/status at that SHA and revalidate reviews independently.                                                                                                                                                                                                                                  | Reusing prior-SHA CI.                                                                                     |
| Check run/status transition on the **same SHA**                 | Fetch or conditionally revalidate checks; if zero, revalidate combined status. [Check runs can be updated](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks#about-check-runs), and [new commit statuses can be created for a SHA](https://docs.github.com/en/rest/commits/statuses#create-a-commit-status). | SHA-only CI memoization.                                                                                  |
| Merge/close or changed authored/requested/reviewed membership   | Re-run every discovery search. Canonical detail wins if search indexing lags.                                                                                                                                                                                                                                                                | Keeping an old PR because it remains in a cache.                                                          |
| Required page/detail failure                                    | Retain complete last-known-good snapshot; no partial publish.                                                                                                                                                                                                                                                                                | Combining cached discovery with partial fresh results.                                                    |
| Optional review/CI failure, including later page                | Preserve Pending/Unknown and recognized cooldown; never present stale optional status as fresh.                                                                                                                                                                                                                                              | Recovering an earlier approval or passing check from a prior snapshot.                                    |
| Sign-out, reset, token/account change, generation invalidation  | Abort, clear volatile entries and reject late cache fills/writes.                                                                                                                                                                                                                                                                            | Reusing validators across credentials or sessions.                                                        |

GitHub's REST [review endpoint](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request)
returns chronological reviews, while the current reducer uses the last
returned state per reviewer, including COMMENTED/DISMISSED/PENDING replacing
that reviewer's earlier state. Review-request discovery and conversation
comments are separate concepts. Neither a stable SHA nor `updated_at` is a
documented completeness certificate for reviews or CI; treating either as one
would require a separate correctness proof.

For future conditional review caching, store a validator, previously validated
body **and Link chain metadata for each exact page**. Revalidate every page in
the new chain, following only the validated `next` URLs. A 304 can supply the
cached validated representation for _that same page_; a 200 replaces it. If
page count, order, Link targets or validation changes, discard irrelevant old
pages. A missing page, malformed Link, ceiling hit, cancellation or rate limit
must not produce a status from mixed partial history. No "append only" rule
is established: a dismissal can alter an old effective review without a new
tail page.

## Deterministic benchmark

Run `node scripts/measure-incremental-refresh.mjs --summary` for tab-separated
selected rows, or omit `--summary` for all 280 JSON rows. The
[unit assertions](../../tests/unit/incremental-refresh-benchmark.unit.test.ts)
check matrix coverage, cold/restart parity, safe detections, three unsafe
misses, failure/cancellation and byte/cost ordering. No GitHub credentials or
network are used.

Fixture sizes are **5, 20, 40, 100 and 150** distinct PRs, distributed across
three search streams with one page each. Every PR has canonical detail,
reviews and check runs; every 41st PR has 101 reviews, every 29th may have
145 checks, and every 37th has no checks and uses combined status. The target
PR starts with an approval; the new-review scenario appends a change request,
while dismissal changes that existing approval to DISMISSED. Bodies are
sanitized GitHub-shaped JSON generated deterministically; their byte counts
are fixture-dependent. The simulator preserves one `/user` call, three
concurrent search streams, four PR workers, required detail before concurrent
review/CI, and sequential pagination within each endpoint. Virtual response
delays are fixed at user 80 ms, search 110, detail 100, review 90, checks 120,
status 80. **200 and 304 have equal virtual delay**, deliberately granting no
unproven latency benefit. There is no JavaScript parsing, encryption, browser
worker, transport compression or actual network timing in this virtual clock.

Strategies compared on the _same_ fixtures:

1. **Current**: unconditional REST calls; no cache.
2. **Detail ETag**: previously validated canonical detail only, held in volatile
   account-scoped memory; other endpoints unchanged. This models a prospective
   implementation, not production code.
3. **All ETag**: previously validated detail, every review/check page and
   combined status; user/search remain unconditional. This assumes authenticated
   304s with correctly scoped, still-complete cached representations and is an
   upper-bound study, not a shipping proposal.
4. **Unsafe SHA skip**: after unchanged detail/SHA, skip review/CI calls. It is a
   counterexample, **not** a correctness-preserving candidate.

The model assumes an authorized, valid-cache 304 costs zero _primary_ core
units per GitHub's documented rule, while each 200 or error costs one modeled
unit; search units are tracked separately. It does **not** estimate secondary
points, conditional-cache hit rates, TLS/wire bytes or real wall-clock savings.
The public probe was unauthenticated and showed different 304 charging.

### Size comparison: cold and unchanged warm

All figures below are **synthetic**. `core/search` are modeled primary units;
`bytes` are decoded fixture JSON; `ms` is the conservative virtual refresh
duration. Safe ETag strategies make exactly as many HTTP calls as current.

| PRs | Current requests |   Cold bytes / ms | Warm detail-ETag core/search, bytes / ms | Warm all-ETag core/search, bytes / ms |
| --: | ---------------: | ----------------: | ---------------------------------------: | ------------------------------------: |
|   5 |               21 |      64,906 / 630 |                       13/3, 39,586 / 630 |                        1/3, 998 / 630 |
|  20 |               66 |   162,131 / 1,370 |                     43/3, 60,818 / 1,370 |                    1/3, 3,330 / 1,370 |
|  40 |              128 |   326,119 / 2,510 |                    85/3, 123,466 / 2,510 |                    1/3, 6,453 / 2,510 |
| 100 |              313 |   848,770 / 5,970 |                   210/3, 342,094 / 5,970 |                   1/3, 15,815 / 5,970 |
| 150 |              468 | 1,274,255 / 8,810 |                   315/3, 514,079 / 8,810 |                   1/3, 23,715 / 8,810 |

Cold, worker-restart and cache-expiry trials of the safe strategies return to
the current request, byte and virtual-time costs. At 40 PRs an unchanged warm
detail-only ETag cache models 40 fewer core primary units (125→85) and 62.1%
fewer decoded fixture bytes, but **zero fewer HTTP requests and zero modeled
latency saving**. At 150 PRs it models 150 fewer core units (465→315) and
59.7% fewer fixture bytes. These are upper bounds for a fully warm cache with
universal detail validators, not expected production savings. Real hit rates,
bytes, timing and authenticated charge need controlled pilot measurement.

### Scenario outcomes at 40 PRs

`Current / detail / all / unsafe` are HTTP request counts. Detection here means
that a changed endpoint representation reaches the model, not a run of the
production review reducer or UI. All safe strategies detect each modeled
successful change (1/1); the unsafe strategy misses the
review, dismissal and same-SHA CI changes (0/1). "Retain" means no snapshot
write; "pending + cooldown" preserves the existing optional failure path.

| Scenario                   | Current / detail / all / unsafe | Safe result                                               | Unsafe risk                                          |
| -------------------------- | ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| Cold                       | 128 / 128 / 128 / 128           | Same cold cost                                            | None in cold case                                    |
| Warm unchanged             | 128 / 128 / 128 / 44            | Same correct state                                        | Saves calls, but only by skipping independent checks |
| New review                 | 128 / 128 / 128 / 44            | Detects 1/1                                               | Misses 0/1                                           |
| Review dismissal           | 128 / 128 / 128 / 44            | Detects 1/1                                               | Misses 0/1                                           |
| New commit                 | 128 / 128 / 128 / 46            | Detects 1/1; new-SHA checks                               | Detects modeled detail change                        |
| CI changes on same SHA     | 128 / 128 / 128 / 44            | Detects 1/1                                               | Misses 0/1                                           |
| Requested reviewers change | 128 / 128 / 128 / 46            | Detects 1/1, refreshes discovery                          | Detects modeled detail change                        |
| Draft/ready transition     | 128 / 128 / 128 / 46            | Detects 1/1                                               | Detects modeled detail change                        |
| Merged/closed              | 125 / 125 / 125 / 43            | Detects removal via search                                | Detects modeled removal                              |
| Required detail failure    | 126 / 126 / 126 / 44            | Retains snapshot; no partial publish                      | Faster failure is not correctness benefit            |
| Optional review rate limit | 128 / 128 / 128 / 44            | Pending + cooldown; no stale review reuse                 | Skips request and misses cooldown                    |
| Session cancellation       | 8 / 8 / 8 / 8                   | No snapshot write or further PR work                      | No modeled difference                                |
| Worker restart             | 128 / 128 / 128 / 128           | Volatile cache cold; 124 entries invalidated for all-ETag | No warm assumption survives                          |
| Cache expiry               | 128 / 128 / 128 / 128           | Refetches after invalidation                              | No warm assumption survives                          |

The simulator's required-detail failure happens after search and before that
PR's optional work; other scheduled PRs continue, matching current
ordinary-failure behavior. Its rate limit occurs on an optional review request,
so the snapshot remains publishable with Pending and cooldown. Cancellation is
injected after `/user`, three searches and four detail starts, before optional
work. These event boundaries are fixed, not a probabilistic workload study.
The 40-PR unsafe warm shortcut produces 44 requests and a 1,190 ms virtual
duration versus 128 and 2,510 ms current, but fails three correctness cases;
its apparent savings are therefore **NO-GO**. Safe conditional requests retain
the 2,510 ms conservative duration and have no proven real latency benefit.

## Security, persistence and browser behavior

Cache keys must include authenticated account/token identity, exact API origin,
path, query parameters, Accept/API version and any representation-affecting
headers. A cached 304 is usable only with its matching, validated 200 body and
the same credential scope. A 304 with no entry, a changed identity or an
ambiguous validator is a failure/re-fetch decision, never a blank success.
Do not log tokens, private response bodies, sensitive URLs or raw cache keys.
Bound bytes and entries; avoid retaining long review bodies unnecessarily.

An in-memory cache is simplest and avoids new storage schema or plaintext
persistence, but is erased when Chrome MV3 suspends the worker; Firefox MV2's
background lifetime differs and must not be relied upon for correctness.
Short TTLs across refreshes do not certify review/CI freshness. A persistent
cache would need encryption with the existing account key, schema validation,
size/expiry limits, account/reset cleanup, and writes coordinated with the
single-writer encrypted-app-data boundary. It must not repurpose the separate
unencrypted rate-limit cooldown key. Session generation and AbortSignal checks
must surround cache lookup, 304 handling, response parse and cache commit; a
retired refresh must not populate a new session's cache. None of this is added
to production here.

## Ready-for-review age (secondary question)

GitHub exposes `ready_for_review` and `convert_to_draft` events through the
[REST issue timeline](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types#ready_for_review),
and GraphQL has a [ReadyForReviewEvent](https://docs.github.com/en/graphql/reference/pulls#readyforreviewevent).
The current detail/review/CI requests do not fetch that event history. A
correct latest-ready timestamp needs a bounded timeline scan (including
draft→ready cycles), not just PR `created_at` or `updated_at`. A separate REST
timeline per PR would add at least `N` requests and potentially pagination;
neither ETag caching nor the present discovery results remove that cold cost.
Do **not** add that call merely for age. Defer unless a later independently
validated batched or already-needed timeline source makes it cheap.

## Recommendation and small-PR sequence

1. **GO, conditional detail pilot:** Volatile, bounded, account/session-scoped
   cache of validated canonical detail bodies and ETags only. Continue all
   discovery, reviews, checks/status, four-worker scheduling and snapshot
   rules. A 304 reuses the exact cached body then passes existing validation;
   absent/stale cache or 200 follows current path. Test token change, sign-out,
   reset, worker restart, 304-without-body, required failure and abort races.
   Instrument hit rate, decoded bytes, response statuses and authenticated
   rate headers without logging private content. **Expected HTTP saving: 0.**
   Synthetic fully warm upper bound: 40/150 fewer core primary units and
   62.1%/59.7% less decoded fixture data at 40/150 PRs; no proven latency
   saving. Require observed benefit before expanding scope.
2. **Conditional review/CI trial only after pilot evidence:** Per-page validated
   Link/total-count cache and 304 reconstruction in isolated tooling, then a
   small separate production PR if full-history and same-SHA transitions pass.
   Preserve Pending/Unknown and cooldown on partial failures. Do not use a
   terminal-page shortcut or stale-fresh mixing.
3. **Persistent cache design, optional:** Only if measured MV3 restart misses
   erase most pilot benefit; specify encrypted schema, account isolation,
   single-writer integration and eviction in a separate review before coding.
4. **Independent discovery study:** Authenticated search validator probes and
   correctness tests for membership/indexing; do not infer membership from PR
   detail or silently reuse old search pages.

**NO-GO:** `updated_at`/SHA-driven skipping, treating 304 as universally free,
unconditional reuse of old review pages, plaintext persistent API bodies,
GraphQL production migration, and ready-for-review age calls in this PR.
