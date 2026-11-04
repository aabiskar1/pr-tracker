# PR Tracker 1.0.23 release validation

Prepared from `398b15b` on `main`, including merged PR #108, on 2026-11-04.
Only the package versions, release notes and this validation record change.
Dependencies, permissions, application code and release workflows are unchanged.

## Checks

Local checks used a portable Node.js 24.22.2 / npm 11.19.1 installation verified
against Node's published SHA-256 checksum. Browsers were Chrome for Testing
156.0.8078.47 and Firefox 159.0.1 on Windows NT 10.0.26300.

| Check                                               | Result                                           |
| --------------------------------------------------- | ------------------------------------------------ |
| TypeScript and Oxlint                               | Passed                                           |
| Unit tests                                          | 719 passed across 35 files                       |
| Headed Chrome E2E                                   | 61 passed across 11 files                        |
| Headless Chrome E2E                                 | 61 passed across 11 files                        |
| Existing Firefox runtime tests                      | 2 passed                                         |
| Additional local Firefox smoke journey              | 1 passed, using DOM events and fixture transport |
| Chrome and Firefox production builds                | Passed                                           |
| Changed-file Prettier and PR diff whitespace checks | Passed                                           |
| Full formatting script on a clean LF snapshot       | Passed                                           |

Both Chrome suites include the existing screenshot/layout, theme, age-display,
authentication, filtering, sorting, Reviewed, notification, refresh, cache,
sign-out and reset coverage. The generated light CI and dark Advanced-menu
screenshots were visually inspected. No screenshot baseline changes are included.
The optional live-token promotional screenshot capture was not run; it is not
a regression suite, and the configured test token previously returned 401.

The existing Firefox tests cover the actual toolbar Advanced menu and encrypted
cache persistence, popup reopening, independent review/CI refresh, sign-out and
reset. An additional temporary journey reused the same fixture bridge to check
authentication/password setup, unlock, PR loading, manual refresh, Reviewed,
CI filtering, sorting/search, notifications, age text, dark/light themes and
the Full Reset confirmation. It passed in the production Firefox MV2 build.
The temporary test is not part of the PR; the existing test suite is unchanged.

Firefox BiDi rejected native input activation and context-specific network
interception in extension pages. The extra journey therefore uses DOM events
and fixture `fetch` responses. It does not establish native pointer hit-testing
or authenticated network behaviour. No manual browser testing is claimed.
The native-network and longitudinal cache gaps recorded in the
[cache investigation](investigations/encrypted-etag-cache-pilot.md) remain.

The Windows working-tree formatting check still reports 122 unrelated files:
119 have checkout line-ending differences, and three are untracked local
artifacts with existing formatting differences. None is part of this PR.
All 205 supported tracked files passed Prettier when read directly from Git;
the full `npm run check-format` also passed in an LF snapshot with the release
changes overlaid. Existing files were not reformatted.

## Packages

Created with `npm run zip` and `npm run zip -- -b firefox` under Node 24.
Both run production builds through WXT. Packages are local preparation
artifacts under `.output/`; they have not been uploaded or published.

| Package                         | ZIP bytes | SHA-256                                                            |
| ------------------------------- | --------: | ------------------------------------------------------------------ |
| `pr-tracker-1.0.23-chrome.zip`  |   186,202 | `f5d5bd3353c54a30ea003339a309575e44506ae9d46adecbabde10c979b85df2` |
| `pr-tracker-1.0.23-firefox.zip` |   186,191 | `2f3d91fc81f1c7c96457ec4e1823c2dd9bf9f70ab484e2c922c8e24b3c0cb422` |

Both archives passed ZIP/CRC checks and contain exactly 12 runtime files. Every
archived file matches its production build byte for byte. Both manifests report
PR Tracker 1.0.23. Chrome uses MV3, `popup.html` and `background.js` as its service
worker; Firefox uses MV2, the same popup and a background script, retaining
`{dabd690e-283a-4c0a-98de-3fc963365d13}` as its extension ID.

Permissions remain `storage`, `notifications`, `alarms` and access to
`https://api.github.com/*`, represented appropriately for each manifest format.
Toolbar icons and Watchtower branding match the v1.0.22 package bytes. Popup
JavaScript/CSS and all manifest assets are present. The file allowlist and
content scans found no development files, tests, fixtures, screenshots, source
maps, environment files, configured credentials or private runtime data.
WXT's extra source archive was discarded; it is not a release package.

The ZIPs are about 2.6% larger than the published v1.0.22 assets (181,543 and
181,532 bytes), consistent with the CI/filtering, review-history and cache
changes already merged. There is no significant package-size increase.

The packages retain the existing [Chrome ZIP/manifest layout](https://developer.chrome.com/docs/webstore/prepare)
and [Firefox manifest format](https://extensionworkshop.com/documentation/publish/distribute-manifest-versions/).
Chrome's package has no public manifest key, so its store listing ID cannot be
proved from the ZIP alone; the publishing workflow separately enforces the
existing Chrome submission target. Actual store validation and review were not
attempted and are not implied by these local checks.

## Release process

The existing process remains separate:

1. Review and merge the release-preparation PR after `buildandtest / verify` passes.
2. Run **GitHub Release** from the merged `main`, initially with its default
   dry run. It rebuilds and validates the packages as `extension-chrome.zip`
   and `extension-firefox.zip`, then uploads workflow artifacts only.
3. A separately authorised non-dry run checks that the dispatched commit is
   still latest `main` and that the tag/release do not exist before creating
   `v1.0.23` and a GitHub Release with those verified assets.
4. **Publish to Stores** consumes the original published assets and supports
   Chrome and Firefox independently. It requires dashboard confirmation and
   `browser-stores` approval, then revalidates asset identity and bytes.

The live environment settings were checked read-only: `browser-stores` still
requires `aabiskar1` to review, permits self-review and restricts deployments
to protected branches. Workflow guards and their existing unit tests are
unchanged. No release or store workflow was dispatched. No merge, tag, GitHub
Release or browser-store submission was made during preparation. PR CI results
are recorded on the pull request.
