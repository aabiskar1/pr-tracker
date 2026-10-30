# Development workflow

## Prerequisites

- Node.js 24 LTS. The GitHub Actions workflows use the Node 24 major release.
- npm, using the committed `package-lock.json`.
- Chrome or Chromium for local development and Puppeteer E2E tests.
- Firefox when manually validating the Firefox build.

The committed `mise.toml` selects Node 24 for developers who use mise.

## Install dependencies

For a clean, lockfile-reproducible install, run:

```sh
npm ci
```

`npm install` is appropriate when intentionally changing dependencies and the
lockfile in a separately scoped dependency task. The `postinstall` script runs
`wxt prepare`, and the `prepare` script installs the Husky hook.

## Development

Start WXT development mode for the default browser target:

```sh
npm run dev
```

There is currently no separate Firefox development script. Use the Firefox
build command below and load the produced extension for Firefox validation.

## Shared UI components

Reusable UI primitives live in `src/components/ui/`, shared class-name helpers
live in `src/lib/`, and semantic tokens live in `src/styles/tokens.css`. Use
the primitives before adding feature-local button, badge, card, input,
separator, or loading-placeholder styles. Keep generic primitives free of
GitHub API types and browser-extension behavior; compose them in feature
components instead.

The repository's `components.json` follows the shadcn/ui Tailwind v4 setup:
CSS variables are enabled, the Tailwind config path is intentionally empty,
and aliases point into `src/`. To add an individual component, review the
generated diff from the current CLI before accepting it:

```sh
npx shadcn@latest add <component>
```

Do not install the whole registry. Add Radix primitives or other component
dependencies only when the selected component actually needs them. Preserve
the local compact sizing, `data-slot` attributes, native element semantics,
and existing `cn()` helper. New UI should use semantic utilities such as
`bg-background`, `text-muted-foreground`, and `focus-visible:ring-ring`; do not
add a second token source or hard-code theme-specific colours in components.

`src/styles/tokens.css` is the sole colour-token source. The popup reads the
unchanged `theme-preference` key (`light`, `dark`, or `auto`), applies the
resolved value as `data-theme` before mounting React, and follows system colour
scheme changes while automatic mode is active. Do not add a theme provider,
another root class, or a second storage value.

When changing the existing production popup, keep its original visual
treatment. The `--popup-*` values in that same token file and the
`.screen-prlist`/`.screen-auth` rules in `src/theme.css` preserve the current
purple/green actions, charcoal dark surfaces, solid status labels, neutral PR
card rails, and compact controls. Do not substitute a generic primitive's
default appearance merely because it has the same semantic role. The dark
search and custom-query backgrounds should match the original filter/card
surface. Keep the coloured age indicator. The generic shared primitives remain
available for new UI without popup-specific styling.

Production buttons and text/password/search inputs should use `Button` and
`Input`. CI and review state must use the corresponding separate `Badge`
variants; do not collapse them into one status. Native selects and checkboxes
currently remain feature markup with semantic token classes. The notification
switch, error banner, and production-appearance compatibility rules remain
narrowly scoped in `src/theme.css`.

Every interactive control needs an accessible name, a visible keyboard focus
state, and a real disabled state where applicable. Status badges must include
text or an accessible label in addition to colour. Loading animation must
respect `prefers-reduced-motion`. Check new components in both root themes and
at popup density rather than adopting page-sized dashboard defaults.

Chrome and Firefox continue to share the same components. Avoid CSS or Web APIs
that require new extension permissions or violate extension Content Security
Policy. Do not remove the engine-specific popup sizing and scrollbar rules in
`entrypoints/popup/style.css`; verify both production builds and perform a
manual Firefox check when a Firefox runtime is available.

The remaining global compact-spacing rules in that file are intentional legacy
compatibility. Keep the zero-specificity `:where(:not([data-slot]))`
exclusions when changing them, and migrate a consumer before removing a
selector. Stable `.screen-auth` and `.screen-prlist` hooks—not exact
utility-class sequences—are the browser sizing contract.

## Compile and type-check

```sh
npm run compile
```

This runs TypeScript with `--noEmit`.

TypeScript 7 is the supported compiler. Oxlint remains the sole lint path and
does not depend on the TypeScript programmatic API.

## Format and lint

Check formatting without changing files:

```sh
npm run check-format
```

Format the repository when formatting changes are intended:

```sh
npm run format
```

The format script also sorts `package.json` and `tsconfig*.json`. Review its diff
and do not commit unrelated rewrites. Run Oxlint with:

```sh
npm run lint
```

The Husky pre-commit hook runs lint-staged. Staged JavaScript, TypeScript, CSS,
Markdown, YAML, and JSON are formatted; selected JSON files are also sorted.

## Unit tests

```sh
npm run test:unit
```

`npm test` is currently an alias for the unit suite.

## E2E tests

The required behavioural suite is deterministic and needs no GitHub token or
public-network access. Run it in a visible Chrome window with:

```sh
npm run test:e2e
```

The script first builds Chrome in Vite `test` mode and then executes the focused
files under `tests/e2e/`. `tests/e2e/setup.ts` launches Puppeteer with the
isolated `.output/chrome-mv3-test` build. Unit tests do not load this setup or
launch Chrome. The CI-oriented headless command runs the same suite:

```sh
npm run test:headless
```

Optional promotional screenshot capture remains separate. It requires a
`GITHUB_TOKEN` with `repo` scope in the ignored `.env.test` file and may make
live GitHub requests:

```sh
npm run test:e2e:screenshots
```

Chrome MV3 is the only runtime E2E target. Firefox MV2 remains covered by the
build command, not browser automation. See `docs/testing.md` for the service
worker restart gap and deterministic harness details.

The component foundation has a test-build-only showcase. Build with
`npm run build:e2e`, load the popup with the
`?design-system-showcase=1` query parameter, and inspect Button, Badge, Card,
Input, Separator, and Skeleton examples in simultaneous light and dark token
scopes. The branch is gated by `import.meta.env.MODE === 'test'`, so it is not
available in production builds and requires no manifest permission.

Run unit and E2E tests together with:

```sh
npm run test:all
```

See `docs/testing.md` for current isolation and coverage limitations.

## Builds

Build the Chrome Manifest V3 extension:

```sh
npm run build
```

Build the Firefox Manifest V2 extension:

```sh
npm run build:firefox
```

Build both targets:

```sh
npm run build:all
```

WXT writes build output under `.output/`. Load `.output/chrome-mv3` as an
unpacked Chrome extension. For Firefox, load a file from
`.output/firefox-mv2` as a temporary add-on.

## Packaging

The repository exposes WXT's default packaging command:

```sh
npm run zip
```

The release workflow builds both browsers and creates its Chrome and Firefox
archives separately. Do not modify release configuration or publish artifacts
as part of ordinary development.

## Branch and pull-request workflow

`main` is protected. Never commit directly to it.

1. Fast-forward local `main` from `origin/main`.
2. Create a dedicated, descriptively named branch.
3. Keep the change focused; preserve unrelated local work.
4. Inspect the complete diff and run proportionate checks.
5. Commit with a focused message and push the branch.
6. Open a pull request targeting `main` and describe the change, verification,
   and remaining risks.
7. Wait for required CI checks and review. Do not merge your own PR unless
   explicitly instructed.

Do not mix feature work, dependency upgrades, and architecture refactors
without explicit approval.

## Expected pre-PR checks

For a normal source change, run:

```sh
npm run compile
npm run check-format
npm run lint
npm run test:unit
npm run build
npm run build:firefox
```

Run `npm run test:e2e` for extension/user-workflow changes and whenever the
required local browser and test credential are available. Documentation-only
changes should at minimum pass `npm run check-format`; run other existing checks
when reasonable and report exactly what ran. If a command cannot run because of
an environment requirement, document that fact rather than silently omitting it.

## Release preparation and publishing

Prepare a release from the latest `main` on a dedicated branch. Review
`git log vPREVIOUS..HEAD` and the complete diff; bump `package.json`, both
lockfile version fields, and add `docs/release-notes-VERSION.md`. Preserve
production icons and Watchtower branding. Open a preparation PR and leave
merging, tagging, and publishing to the maintainer's explicit decision.

Run compilation, lint, formatting, unit tests, headed and headless E2E tests,
and deterministic screenshot/layout checks before packaging. The release
workflow repeats these checks, with a virtual display for headed Chrome:

```sh
npm run compile
npm run lint
npm run check-format
npm run test:unit
python3 -B -m unittest discover -s tests -p release_packages_test.py
npm run test:e2e
npm run test:headless
# Following the test build, capture/assert existing visual regression fixtures:
CI=true VISUAL_REF=release npx vitest run --config vitest.e2e.config.ts tests/e2e/visual-compat.e2e.test.ts
npm run zip
npm run zip -- -b firefox --no-sources
python3 scripts/validate-release-packages.py
```

On the shared Linux virtual display, the workflow adds
`-- --no-file-parallelism` to the headed E2E command so independent Chrome
windows do not steal focus from accessibility and native-popup checks.
Headless files retain their normal parallel scheduling. Lifecycle assertions
wait for committed encrypted preferences before checking the reopened popup.

Use PowerShell environment assignment (`$env:CI = 'true'`,
`$env:VISUAL_REF = 'release'`) on Windows. If PowerShell's `npm.ps1` drops command
flags, use `npm.cmd run zip -- -b firefox --no-sources`. Python 3 is needed only
for the release-package checks and their standard-library tests; no extension
runtime dependency is added. `npm run zip` and its Firefox variant build
production packages, not the test build. Outputs are
`.output/pr-tracker-VERSION-chrome.zip` and
`.output/pr-tracker-VERSION-firefox.zip`. `--no-sources` prevents WXT from
creating an additional Firefox source archive; only the two validated extension
ZIPs are uploaded. The validator checks package/lockfile, build-manifest, and ZIP
versions, Chrome MV3 / Firefox MV2 targets, original
icon and branding bytes, branding references, ZIP integrity, exact build bytes,
and an allowlist that excludes development/test files and test-only code.

The screenshot regression fixtures assert layout and computed styles and can
capture PNG/JSON evidence under `screenshots/visual-compat/`; they do not impose
a pixel-diff baseline. Optional live-token promotional screenshot capture is
separate and is not a release prerequisite. Firefox is build-validated; runtime
E2E runs Chrome only.

After the preparation PR is reviewed and merged, open **Actions → Release
Extension → Run workflow**. Select a mode explicitly:

| Mode              | Validation and workflow artifacts | Tag and GitHub Release                              | Browser stores                               |
| ----------------- | --------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Dry Run (default) | Yes                               | No                                                  | No                                           |
| GitHub Release    | Yes                               | Yes, with both ZIPs and the version's release notes | No                                           |
| Full Release      | Yes                               | Yes                                                 | Chrome publish and listed Firefox submission |

Dry Run may run on a preparation branch and may be rerun. It creates only
workflow artifacts named by run ID and attempt, including screenshot evidence.
Real releases must be dispatched from `main` at its latest commit. Version and
release-notes paths derive from checked-in metadata, never from free-form
inputs; v1.0.22 uses `docs/release-notes-1.0.22.md` as its release description.

All modes share a non-cancelling concurrency group. Real release attempts
recheck latest main after validation and immediately before store submission.
The publishing job creates a lightweight version tag atomically without force,
creates a draft, uploads the two versioned ZIPs without clobbering assets,
compares uploaded asset sizes and SHA-256 digests, and then publishes its draft.
An existing tag or release (including a draft) is a hard stop. Each store job
checks that its downloaded ZIPs match the published release and the tag still
identifies the validated commit. Store jobs run independently, so one failure
does not hide or cancel the other's result; the workflow summary reports each.
Successful submission is not a guarantee of store approval or immediate listing.

Real release reruns are deliberately disabled (`github.run_attempt` must be 1).
A new dispatch of the same version is also blocked by the existing tag/release.
This prevents accidental duplicate releases and store resubmissions. If a run
fails after creating a tag or while submitting to a store, inspect the tag,
draft/release, assets, workflow logs, and each store dashboard before taking any
manual recovery action. Do not force-push a tag, clobber assets, delete published
history, or blindly rerun publication. A GitHub-only release cannot later be
promoted to Full Release automatically; submit its already-validated packages
manually after reviewing store state, or prepare a new version.

Global workflow permissions are `contents: read`; only the GitHub publishing
job has `contents: write`. Checkouts do not persist credentials. Dependency
installation and tests run without a write token or browser-store credentials.
Existing Chrome credentials (`CHROME_EXTENSION_ID`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) and Firefox credentials
(`FIREFOX_API_KEY`, `FIREFOX_API_SECRET`) remain GitHub Actions secrets, exposed
only to their respective store step. The existing store integrations are pinned
to the resolved commits of their current versions. Restrict write access to
main/workflows and release secrets; protected environments or tag rules can add
maintainer approval if configured separately.

The workflow cannot make GitHub and the two stores one atomic transaction.
A commit can also land on main just after a freshness check. Failures or network
ambiguity can leave a tag, draft, published release, or one accepted store
submission; manual reconciliation is required. No live publishing integration
is exercised during release preparation. Validate YAML and expressions with
`actionlint .github/workflows/release.yml`; its embedded shell checks also run
when ShellCheck is installed. Release guard tests mock GitHub and reject stale
commits, wrong branches/modes, retries, existing releases, and changed assets.
