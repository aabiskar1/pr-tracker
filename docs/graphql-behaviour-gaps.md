# Behaviour that GraphQL cannot currently reproduce reliably

The compact GraphQL PoC is **not** a drop-in replacement. Some selected fields
lose information needed for existing behaviour; other gaps are unproven parity
or missing integration. This investigation has not established that every
existing domain rule is inherently impossible using all available GraphQL raw
fields. It has established enough differences to reject a summary-only switch.

## Known PoC mismatches

The first two rows describe information lost by aggregate fields. The third is
a fixable client/error-isolation gap, not an inherent inability of GraphQL to
support optional status lookups.

| Existing behaviour                                                                                                         | Why the selected GraphQL data is insufficient                                                                                                                          | Evidence and preservation path                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest returned review per user, with changes-requested precedence over approval                                           | `reviewDecision` is an aggregate, not the review sequence or per-user last state. A scalar cannot reconstruct that history or REST's page boundary.                    | Paired fixtures explicitly differ for approval followed by comment/pending review and an aggregate still requiring review. Keep REST reviews, or prove raw-history selection and reducer equivalence.                                                                                                                 |
| Check runs determine CI whenever the returned run list is nonempty; legacy status is considered only if that list is empty | `statusCheckRollup.state` combines both sources without telling the current mapper which source determined the result.                                                 | Passing checks plus failing legacy status and failing checks can share a failing rollup while current REST labels differ. Fixtures expose the mapping gap; live history had two CI-label mismatches, whose precise causes were not diagnosed. Retain REST CI calls or validate separate raw checks/status reductions. |
| Successful refresh with pending optional status when reviews/checks are inaccessible                                       | The current single-query PoC rejects every GraphQL error, including optional-field errors with surviving required data. A failure can also null data needed elsewhere. | Paired optional-403/partial-error test observes REST success versus GraphQL rejection. Split optional queries or implement validated error-path handling; retain REST when required information is unavailable.                                                                                                       |

These differences affect review/CI badges, status filtering and review-based
most-stale ordering in `usePullRequests`. Reviewer-list changes can affect its
urgency ordering. They are user-facing changes even when the same PR identities
are discovered. Returning a stricter error instead of a successful pending-status
snapshot is also a behaviour change.

The synthetic review scenarios supply explicit summary decisions; they do not
prove that GitHub applies a particular branch-protection rule to those histories.
The conclusion is that summary substitution lacks an equivalence contract and
already has fixture/live counterexamples, not that every counterexample was
observed on a live repository. GitHub exposes
[raw review history and aggregate decisions](https://docs.github.com/en/graphql/reference/pulls),
and [raw checks, statuses and rollups](https://docs.github.com/en/graphql/reference/commits).

## GraphQL-only parity that remains unreliable or unestablished

| Requirement                                                                                                 | Current evidence / missing guarantee                                                                                                                                                                                                                                                       | Safe option while parity is unresolved                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preserve the current first 30 chronological REST reviews, including supersession within that page           | REST documents chronological default-page selection. The reviewed GraphQL `reviews` connection has cursors/first/last and state/author filters, but no demonstrated contract equating its selected sequence to that REST page. Fetching all history or `latestReviews` changes the inputs. | Keep the same REST endpoint. Test cross-page, pending/dismissed and deleted-author cases before claiming an equivalent GraphQL reducer.                                               |
| Preserve the current default `latest` first 30 REST check runs across the commit                            | GraphQL has run filters, including latest selection, and raw contexts/suites. A first page of mixed contexts or concatenated per-suite results has not been shown to equal the REST run page/order.                                                                                        | Keep REST check-runs/combined-status calls. Validate reruns, multiple apps/suites, default filtering and page selection before replacement.                                           |
| Reject the same incomplete search results as REST                                                           | GraphQL's search connection does not expose REST's `incomplete_results` flag. Counts/cursors/errors can catch known failures but do not reproduce that exact signal or guarantee a complete changing dataset.                                                                              | Retain REST discovery if that exact signal is required; otherwise document and test an equivalent completeness policy without claiming identical backend failure detection.           |
| Return the same discovery membership/order under index lag, concurrent updates and arbitrary custom queries | Only two repository-scoped live custom queries were compared. Cursor pagination does not make either API a snapshot. Overlapping/reordered pages can trigger different client rejection policies.                                                                                          | Validate default/private/SSO/custom-query cases and deterministic mutation scenarios. Keep source union/deduplication and existing search behaviour until equivalence is established. |
| Use the same current commit's CI on later pushes, forks or deleted refs                                     | REST uses canonical `head.sha` with the base repository. The PoC consumes the PR rollup without independently pinning/validating that association. Successive supplied rollups do not prove live commit matching.                                                                          | Fetch/pin the canonical head identity and validate repository/commit access, or retain the REST CI lookup.                                                                            |
| Produce byte-identical actor/avatar fields                                                                  | The live comparison observed differing author objects; a public follow-up confirmed equal login and different avatar URL query parameters. This does not prove different visible avatars, but exact URL parity is unestablished.                                                           | Compare rendered identity/avatar behaviour separately from raw JSON equality. Do not strip opaque URL parameters or replace identity keys merely to suppress differences.             |

Source contracts: [REST reviews](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request),
[REST check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference),
[GraphQL review fields](https://docs.github.com/en/graphql/reference/pulls#pullrequest),
[check filters](https://docs.github.com/en/graphql/reference/checks#checkrunfilter),
and [GraphQL search fields](https://docs.github.com/en/graphql/reference/search).
Absence of a demonstrated cross-API equivalence is not proof that no query could
match; these items are unresolved requirements, not categorical API impossibility.

## Engineering gaps that are not inherent API blockers

- Multiple individual reviewers, team unions and nested pagination are exposed
  by GraphQL. The current 100-reviewer rejection/null policy is a PoC limitation,
  not proof that GraphQL cannot retrieve the reviewers. Adding team avatars would
  change today's individual-reviewer UI and is outside this goal.
- Stable PR identity is available through `fullDatabaseId` when nonnull and
  safely representable. Opaque node IDs or PR numbers must not replace existing
  numeric hidden/notification keys. IDs beyond JavaScript's safe-integer range
  are a domain/storage limitation requiring separate work, not evidence that
  GraphQL cannot represent large IDs.
- Discovery-source union, reviewed-only retention, hidden state, filters,
  notification suppression/replay, cache preservation and session cancellation
  are application decisions. They can remain in the existing modules; the PoC
  has not integrated and verified those boundaries.
- GraphQL-aware error classification and persisted cooldowns can be implemented.
  HTTP 200 errors, error paths and original headers must reach the existing
  lifecycle. Different API budgets do not require a new user-facing retry policy.
- Keeping REST `/user` for token scope validation preserves current onboarding.
  A fully GraphQL authentication rewrite is unnecessary for assessing PR fetching.

## Recommendation under the unchanged-behaviour requirement

Do not adopt `reviewDecision`/`statusCheckRollup.state` as replacements for the
existing labels. The supported next candidate is GraphQL discovery/metadata
plus unchanged REST review/CI operations, with REST discovery retained too if
its exact incompleteness/selection behaviour is mandatory. The latter option
can erase the estimated savings, so it must be measured rather than assumed.

Use the [paired scenario tests](../tests/unit/graphql-scenarios.unit.test.ts),
[protocol comparisons](../tests/unit/graphql-protocol.unit.test.ts),
[pagination/error analysis](graphql-pagination-errors-limits.md), and
[live parity measurements](graphql-live-measurements.md) as the evidence ledger.
Production REST remains unchanged; this document records limitations and safe
fallbacks without implementing a migration or asserting unverified guarantees.
