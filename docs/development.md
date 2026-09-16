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

The script first builds Chrome and then executes the focused files under
`tests/e2e/`. `tests/setup.ts` launches Puppeteer with `.output/chrome-mv3`.
The CI-oriented headless command runs the same suite:

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
