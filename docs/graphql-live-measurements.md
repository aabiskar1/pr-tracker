# Live GitHub fetcher measurements

Measured 2026-10-31 at 01:05 UTC against public `aabiskar1/pr-tracker` data.
The [aggregate JSON artifact](measurements/github-graphql-2026-10-31.json)
contains every trial and endpoint counts/bytes/statuses. These are live
measurements, separate from the [fixture results and hybrid estimates](graphql-investigation.md).

## Method and scope

The opt-in runner executes the current REST `fetchPullRequests` and isolated
GraphQL client, each preceded by `/user`. Both use the same Node native-fetch
instrumentation. It times until the mapped result is ready, including reading
decoded bodies and mapping. The existing four-worker REST schedule is retained;
GraphQL searches/pages are sequential. Browser messaging/notifications are
stubbed; storage, encryption, badge rendering, popup work and browser service
worker lifecycle are excluded. This is fetcher latency, not complete browser
refresh latency.

Runtime was Node v22.14.0 on Windows x64, as provided by this session. The project
targets Node 24; these observations are not a Node 24 or Chrome/Firefox benchmark.
No cache was cleared or controlled. Existing network/connection/server cache
effects can influence timings. Body bytes mean uncompressed/decoded bytes read
by JavaScript, excluding HTTP headers/TLS; compressed wire transfer was not
measured. HTTP counts are instrumented fetch invocations; redirects/retries
inside the network stack are not separately observed.

Workloads use existing custom-query support:

- Open: `repo:aabiskar1/pr-tracker is:pr is:open sort:created-asc`, three paired
  samples, alternating REST/GraphQL order. One PR matched.
- History: `repo:aabiskar1/pr-tracker is:pr sort:created-asc`, one paired sample.
  97 PRs matched, including closed/merged PRs. This scales the comparison but
  does not represent the usual open-PR dashboard workload.

All measured responses were HTTP 200, with complete successful client results.
There is a 400-request ceiling per client trial and a remaining-budget guard.
Two `/rate_limit` probes per trial are outside timing/count/byte totals; eight
trials therefore used sixteen additional probes. A first run with incomplete
REST instrumentation was discarded. A two-request public author-field check
afterward explains one mismatch and is also excluded from trial totals.

## Observed counts, sizes and latency

| Workload / sample | Client  | PRs | HTTP requests | Decoded body bytes | Fetcher elapsed ms | Reported GraphQL query points |
| ----------------- | ------- | --: | ------------: | -----------------: | -----------------: | ----------------------------: |
| Open / 1          | REST    |   1 |             5 |             28,097 |            1,180.0 |                           n/a |
| Open / 1          | GraphQL |   1 |             2 |              2,124 |              719.3 |                             1 |
| Open / 2          | GraphQL |   1 |             2 |              2,124 |              706.2 |                             1 |
| Open / 2          | REST    |   1 |             5 |             28,097 |            1,126.9 |                           n/a |
| Open / 3          | REST    |   1 |             5 |             28,097 |            1,130.3 |                           n/a |
| Open / 3          | GraphQL |   1 |             2 |              2,124 |              779.9 |                             1 |
| History / 1       | REST    |  97 |           311 |          2,801,570 |           18,698.4 |                           n/a |
| History / 1       | GraphQL |  97 |             3 |             53,769 |            2,491.3 |                             2 |

Use JSON for full precision. Three small samples and one larger sample cannot
establish a reliable tail percentile, cold-cache effect or general speedup.

The history REST run used one identity request, one search, 97 canonical details,
97 review requests, 97 check-run requests and 18 combined-status fallbacks.
GraphQL used one identity request and two 50-result search pages. Both returned
the same PR identities; no result was silently truncated.

## Actual rate-limit telemetry and uncertainty

GraphQL's `rateLimit.cost` reported **1 per page**, hence 1 primary query point
for each open trial and **2** for the history trial. Each GraphQL trial also made
a REST `/user` call. These are actual server-reported primary query costs for
these specific selections and data, not estimates for future larger queries.

REST before/after resource snapshots showed **4 core + 1 search** units for each
open trial and **310 core + 1 search** for history, matching counted requests
in those resources. These are observed shared-budget deltas, not an isolated
server-side billing trace. Request headers were also collected during the run.

The probes were inconsistent for GraphQL: they showed a zero GraphQL delta for
each open trial despite `rateLimit.cost: 1`, and a delta of 1 for history despite
two reported query points. The history GraphQL request headers also changed
`x-ratelimit-used` from 20 on one page to 5 on the next; its core probe delta was
2 despite one counted `/user` request. These observations prevent treating probe
subtraction as authoritative per-client cost. Snapshot caching, distributed
budgets or other credential activity are possible explanations, not established
causes. The artifact preserves the observed deltas, including anomalies.

Primary core/search/GraphQL resources are separate and must not be added as if
they were one common budget. Secondary-limit CPU/point consumption is not exposed
by this harness and was not measured. GitHub describes the distinct budgets and
the server-reported GraphQL cost in its
[rate-limit guidance](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

## Parity and decision

The open samples had one differing `author` object; history had 97 differing
author objects and **two differing CI labels**, with no review-label difference
in this dataset. A follow-up public PR check confirmed matching author login
but different avatar URL query parameters. Do not interpret every object
difference as a different person; do not silently normalize them to claim parity.

These samples show substantial request/payload savings and lower fetcher latency
for the compact GraphQL selection. They **do not satisfy behaviour preservation**:
CI labels differ, optional-error parity remains unresolved, and the compatible
hybrid is unimplemented. Default authored/requested/reviewed search performance,
private/SSO repositories, error workloads and end-to-end extension latency remain
unmeasured. The recommendation remains to retain production REST pending a
compatible comparison.

## Reproduction and deterministic validation

An existing authenticated GitHub CLI session is required only for manual live
measurement. The runner reads its token into memory and saves aggregate metrics
without titles, identities, URLs, review content or credentials:

```powershell
$env:PR_TRACKER_MEASURE_LIVE = '1'
node scripts/measure-github-graphql.mjs
```

Results are written to ignored `.output/graphql-measurement/results.json`.
Review aggregates before promoting a dated artifact into `docs/measurements/`.
The opt-in script is not part of any automated test or CI command. It uses
existing Vite/Zod/native-fetch tooling, without new dependencies or production
wiring. Automated instrumentation tests use fixed responses and test clocks,
including an actual REST-fetcher integration regression proving its internal
global-fetch requests are counted. They require no live token or network:

```sh
npx vitest run tests/unit/graphql-measurement.unit.test.ts
```
