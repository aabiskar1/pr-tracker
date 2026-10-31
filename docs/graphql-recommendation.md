# Recommendation: retain production REST; evaluate a constrained hybrid next

**Retaining REST is the best production decision now.** The goal requires
meaningful efficiency/performance improvement without changing user-facing
behaviour. The compact GraphQL PoC has impressive measured fetcher savings,
but demonstrably fails that requirement. A hybrid is the preferred follow-up
experiment, not an approved production migration. A full migration is not
justified by the evidence collected.

## Comparison of the three choices

| Choice                 | Efficiency/performance evidence                                                                                                                                                                         | Behaviour and maintenance assessment                                                                                                                                                                                                         | Decision                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Full GraphQL migration | The compact 97-PR live sample used 3 calls, 53,769 decoded bytes and 2.49 s versus REST's 311 calls, 2,801,570 bytes and 18.70 s. GitHub reported 2 primary query points, plus the REST identity call.  | That selection produced two live CI-label differences. Review reducers and optional failures also differ in fixtures. A compatible full implementation needs more raw data, pagination and error handling, so its cost/speed are unmeasured. | Do not adopt the compact selection or treat its timings as compatible-migration evidence. |
| Hybrid REST/GraphQL    | Removing per-PR canonical REST detail calls through batching could save a material fraction of requests while retaining existing supporting calls. Estimates below; no implemented hybrid was measured. | Preserves current review/CI reducers and can retain REST discovery's completeness checks. Still needs metadata, identity, reviewer, head-commit and failure parity, plus two API budgets.                                                    | Best candidate for a separate scoped experiment if further optimization is pursued.       |
| Retain REST            | Measured baseline is less efficient on the large history sample, but current bounded concurrency, cooldown and deterministic coverage are established.                                                  | Keeps existing labels, partial-failure semantics, discovery and storage/notification behaviour without a new transport integration. Avoids accepting unproven equivalence in exchange for estimated gains.                                   | Best current production choice.                                                           |

The [live results](graphql-live-measurements.md) are limited public-repository
custom-query measurements, including closed PR history; they exclude browser
storage/UI work and do not establish default-dashboard or end-to-end browser
latency. They were collected with Node 22, not the project's target Node 24.
Three small samples and one larger sample do not establish representative tail
latency or a universal speedup. Primary API resources differ, and anomalous
shared-budget probes prevent exact per-client attribution from subtraction.

## Preferred hybrid experiment

Keep REST `/user`, current discovery queries and search-page validation, and
the existing REST reviews/check-runs/combined-status operations. Replace only
per-PR canonical metadata hydration with bounded GraphQL batches. This retains
the REST `incomplete_results` signal and deduplicates discovery before metadata
batching. Do not use aggregate review/CI summaries to replace existing labels.

This variant is narrower than switching discovery and metadata together. The
earlier GraphQL-discovery hybrid remains an alternative only after search parity
is established. Keeping discovery REST does not necessarily erase savings:
metadata batching can still replace `N` separate detail requests with `B`
queries. Do not retain every canonical REST detail request as well, since that
would remove the main saving from this hybrid.

For the constrained variant, the **unmeasured request-count estimate** is:

```text
N = unique PRs hydrated; S = existing REST search pages
B = GraphQL canonical-metadata batches; F = REST combined-status fallbacks
REST baseline: 1 + S + 3N + F
Hybrid:        1 + S + B + 2N + F
Potential saving: N - B requests
```

For the measured history workload's `N=97`, `S=1`, `F=18`, assuming two batches
of at most 50 PRs gives **216 versus 311** calls, approximately 31% fewer.
This is an estimate based on observed workload counts, **not** a measured
hybrid, query-point prediction or latency result. Batch size, query shape,
reviewer continuations, permissions and fallbacks can reduce or erase savings.
The existing compact search query is not this batch-hydration implementation.

## Conditions for changing the production recommendation

1. Implement only the isolated metadata-batch comparison. Preserve numeric PR
   identities, individual reviewers, canonical state, repository and head SHA,
   discovery sources and the current UI domain shape. Keep the existing
   manager/storage/notification/session boundaries and client-only architecture.
2. Require equivalent outputs and required/optional failure outcomes in paired
   deterministic tests. Include the existing reviewer/commit/overlap scenarios,
   default/custom searches, null/private actors, large connections, fork/head
   changes, pagination, malformed responses and cancellation. Do not normalize
   away unexplained differences or adopt different status semantics to pass.
3. Integrate GraphQL error types/paths and rate-limit metadata with the existing
   persisted cooldown before testing a production path. Preserve cached data
   and all side-effect guards on incomplete required results. Do not add blind
   REST fallback after throttling/permission failures or long in-worker sleeps.
4. Measure equivalent workloads: default and custom discovery at empty/small/
   paginated sizes, repeated representative public/private data, endpoint and
   budget costs, decoded/wire bytes where available, and browser end-to-end
   latency. Show a material gain without a meaningful small-workload regression;
   do not infer hybrid speed from compact-PoC timings or synthetic delays.
5. Compare the measured benefit with integration/maintenance cost. Run the
   existing compile, lint, formatting, unit, deterministic Chrome E2E and both
   browser-build checks. Keep automated tests credential-free. If parity or a
   meaningful performance gain remains unproven, retain REST.

No new backend, cache framework, GraphQL SDK or dependency is needed for this
next experiment. Exact raw-GraphQL review/check equivalence is a separate,
larger question and is not a prerequisite for this constrained hybrid.

## Evidence and disposition

- [Current REST flow/costs and fixture comparisons](graphql-investigation.md)
- [Measured live counts, bytes, query costs and fetcher latency](graphql-live-measurements.md)
- [Reviewer, review-state, CI and representative scenario analysis](graphql-investigation.md#representative-paired-scenarios)
- [Pagination, error handling and limits](graphql-pagination-errors-limits.md)
- [Known behaviour gaps and unresolved guarantees](graphql-behaviour-gaps.md)

This investigation is complete as a recommendation and isolated PoC. Production
REST is unchanged. Further hybrid implementation, rollout or changes to visible
review/CI semantics are outside this investigation's implemented scope.
