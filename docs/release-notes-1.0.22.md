# PR Tracker 1.0.22

This release keeps pull requests in sight after you review them and includes
the dependency security fixes merged since v1.0.21.

- Added **Reviewed** beside Drafts, Ready, and Hidden. It is enabled by default
  for new users and users upgrading, persists with encrypted filters across
  popup closures, restarts, and password unlocks, and is enabled by Reset Filters.
- Default discovery now also finds open PRs previously reviewed by the signed-in
  user, including approvals, requests for changes, and submitted comment-only
  reviews. Historical reviews remain tracked through later commits and review
  activity until the PR is merged or closed, then disappear on the next
  successful refresh. Regular conversation comments are not submitted reviews.
- Unchecking Reviewed immediately filters cached reviewed-only PRs. Authored PRs
  and outstanding review requests remain visible. This describes your review
  history independently of the existing aggregate Approved / Changes / Pending
  filters. Custom searches retain their existing semantics.
- Historical reviewed-only discoveries do not generate new-PR notification
  spam. Relevant new authored PRs and review requests keep notification support.
  Existing hidden state, encrypted preferences, refresh cancellation, rate-limit
  cooldowns, and trustworthy cached snapshots are preserved.
- Updated vulnerable runtime/test dependencies and removed an unused Puppeteer
  integration and its vulnerable transitive dependencies. The merged security
  update reports zero npm audit findings; this release preparation adds no
  further dependency upgrades.
- Added explicit **Dry Run**, **GitHub Release**, and **Full Release** workflow
  modes. Validation precedes tagging, GitHub publishing, and optional store
  submission. Dry Run is the default and uploads workflow artifacts only.
  Release guards check latest main, versions, package contents and identity,
  existing tags/releases, and retry safety. Store results are reported separately.

Release validation covers compilation, lint, 356 unit/release-safety tests,
10 ZIP-validation tests, 48 headed and 48 headless Chrome E2E tests, seven
deterministic screenshot/layout regression tests, and production Chrome MV3 /
Firefox MV2 builds. Both generated manifests
and both versioned release ZIPs report 1.0.22. The original toolbar icons and
Watchtower popup branding are preserved; development/test files are excluded.

This is release preparation only. No tag, GitHub Release, or store submission
is created by the preparation PR. Firefox runtime E2E remains outside the current
harness. See the development guide for the explicit publishing modes and manual
recovery requirements after a partially completed release.
