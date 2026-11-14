# PR Tracker 1.0.24 release validation

Prepared from `4793948` on `main` on 14 November 2026, after PRs #111, #113,
#114 and #115 were merged. Changes since `v1.0.23` add repository grouping,
toolbar and tooltip improvements, status-colour adjustments and refreshed
documentation and store assets. This release PR changes only package versions,
release notes and this validation record. Dependencies and application code are
unchanged.

## Checks

Checks used Node.js 24.20.0, Chrome for Testing 156.0.8078.47 and Firefox 160.0
on Windows 11 build 26300, in a clean, isolated release worktree.

| Check                                                 | Result                                                    |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `npm ci`                                              | Passed; 0 vulnerabilities reported                        |
| TypeScript and Oxlint                                 | Passed                                                    |
| Unit tests                                            | 812 passed across 37 files                                |
| Headed Chrome E2E                                     | 75 passed across 13 files                                 |
| Headless Chrome E2E                                   | 75 passed across 13 files                                 |
| Firefox runtime tests                                 | 6 passed across 4 files                                   |
| Deterministic screenshot captures                     | 2 Chrome and 2 Firefox tests passed, covering both themes |
| Chrome and Firefox production builds and ZIP creation | Passed                                                    |
| Changed-file Prettier and diff whitespace checks      | Passed                                                    |
| Full formatting check on an LF snapshot               | Passed                                                    |

The Windows working-tree `npm run check-format` reports 235 existing files.
All 235 pass when checked directly from their committed LF contents. The full
script also passes in a fresh LF snapshot with the release changes overlaid;
existing tracked files were not reformatted.

`npm run test:e2e:screenshots`, the separate legacy live-token capture, fails
because the saved token returns HTTP 401 and password setup never appears.
It needs a valid repo-scoped PAT before it can be rerun. The deterministic
captures use fixtures and no real credentials; they do not establish live
GitHub authentication. Generated captures were inspected and restored, leaving
the approved graphics and screenshot baselines unchanged.

The Chrome suites cover authentication, unlock, sign-out, Full Reset, token
replacement, filters, sorting, hiding, notifications, themes, grouping and cache
200/304 handling. Firefox tests exercise actual toolbar panels for grouping,
search, collapse persistence, Advanced CI filters, status contrast and encrypted
cache lifecycle. Firefox uses the existing fixture bridge and DOM-event helpers;
this does not establish native pointer hit-testing or live-network behaviour.

## Upgrade compatibility

Encrypted application storage and key derivation are unchanged. Grouping fields
are optional: missing legacy settings default to All PRs, while existing filters
and account data remain valid. Preference tests cover invalid values, queued
updates, search-time expansion, Reset Filters and storage failures.

The detail-cache projection changed from version 1 to version 2 in the grouping
feature to retain canonical repository identity and activity timestamps. An old
projection is deliberately discarded and rebuilt by the next ordinary detail
request, without an extra grouping-specific request. This is a cache refresh,
not an encrypted account-data or preference reset. Unit tests cover old-cache
invalidation, 200/304 field preservation, credential isolation and last-known-good
snapshots. The version bump does not change encryption keys or storage formats.
An in-place update of an installed v1.0.23 profile remains a manual smoke check;
fixture compatibility tests do not replace that check.

## Packages and assets

Created with `npm run zip` and `npm run zip -- -b firefox`. Both production ZIPs
are retained locally under `.output/` and are not committed or published.

| Package                         | ZIP bytes | SHA-256                                                            |
| ------------------------------- | --------: | ------------------------------------------------------------------ |
| `pr-tracker-1.0.24-chrome.zip`  |   189,948 | `b0e8cd1743b4114070fbe35d3628e639f4ef9288c86eaaae26b2840956df1855` |
| `pr-tracker-1.0.24-firefox.zip` |   189,936 | `678f04ae998f7ed4d70e213641e6b5d45627b9e7551dc32be0712b3f0cc22d1b` |

Both archives pass CRC checks, contain exactly 12 runtime files, have no duplicate
or unsafe paths and match their production build contents byte for byte. Both
manifests report 1.0.24; Chrome uses MV3 and Firefox uses MV2. Firefox retains
`{dabd690e-283a-4c0a-98de-3fc963365d13}`. Permissions remain storage,
notifications, alarms and access to `https://api.github.com/*`. No permissions,
network destinations or telemetry were added.

The existing toolbar icons and watchtower popup branding match v1.0.23 byte for
byte. The runtime-file allowlist excludes documentation screenshots, fixtures,
environment files, source maps and development files; content checks found no
test hooks or fixture credentials. WXT's additional source archive was removed
and is not a release package.

The five approved 1280 × 800 promotional PNGs and 1400 × 560 Chrome marquee
remain unchanged, verified by SHA-256 and PNG dimensions. Their paths and reuse
are documented in [the screenshot guide](screenshots.md),
[Chrome listing notes](../CHROMEWEBSTORE.md) and
[Firefox listing notes](store-listings/firefox.md). No graphics were regenerated.

## Release controls and remaining checks

The release and store workflows are unchanged. GitHub Release defaults to a
dry run and validates package, lockfile, manifests and release-note versions.
Only a separately authorised non-dry run on latest main may create a new tag
and release; reruns and existing tags/releases are rejected. Store publication
is a separate manual workflow with independent Chrome and Firefox jobs,
dashboard confirmation and `browser-stores` approval. Both jobs revalidate the
original release assets after approval.

Live environment settings were checked read-only: `browser-stores` requires
`aabiskar1` to review, permits self-review and restricts deployments to protected
branches. Main requires one PR approval, but its current protection settings
have no required status checks configured. Check `buildandtest / verify` before
merging. Chrome's keyless ZIP cannot independently prove its store identity;
the publishing workflow enforces the existing submission target. No release or
store workflow was dispatched. PR CI results are recorded on the pull request.

Before publication, manually check an installed-profile upgrade and authenticated
refresh with a valid token, then follow the existing dry-run and store-approval
process. Actual store validation, high-zoom usability and real screen-reader use
were not verified here. Pending's white-on-yellow text remains the accepted
contrast exception; this release does not claim it meets WCAG AA.
