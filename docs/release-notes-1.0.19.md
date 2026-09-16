# PR Tracker 1.0.19

PR Tracker 1.0.19 is a maintenance release focused on regression protection,
toolchain modernization, and dependency security. It does not intentionally
change extension features or runtime behaviour.

## Highlights

- Expanded unit regression coverage for GitHub API handling, authentication,
  encrypted storage, preferences, background polling, alarms, and notifications.
- Replaced the legacy browser tests with 17 deterministic Chrome extension E2E
  tests that require no GitHub token or public GitHub API access.
- Updated the supported development runtime to Node.js 24 LTS and the test
  runner to Vitest 5.
- Updated Puppeteer to 25.11.0, removing the vulnerable `extract-zip`
  dependency path and restoring a clean `npm audit` result.
- Replaced ESLint and `typescript-eslint` with Oxlint 1.83.0 while preserving
  the existing static-analysis, React Hooks, and React Refresh protections.
- Updated TypeScript to 7.0.2. Repository measurements showed the median
  `tsc --noEmit` time improving from 1.240 seconds to 0.440 seconds; WXT/Vite
  browser build times were effectively unchanged.

## Verification baseline

- 138 unit tests.
- 17 headed and 17 headless deterministic Chrome E2E tests.
- Chrome Manifest V3 and Firefox Manifest V2 production builds.
- Oxlint and TypeScript compile checks.
- Zero vulnerabilities reported by `npm audit`.

The existing manual release workflow produces `extension-chrome.zip` and
`extension-firefox.zip`. Publishing remains a separate, explicitly triggered
deployment step.
