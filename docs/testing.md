# Testing guide and baseline

This document describes the test system and observable coverage on the branch
where this baseline was created. It does not claim coverage merely because a
feature exists or a test has a broad name.

## Current tooling and layout

Vitest `^4.1.11` is the test runner. `vitest.config.ts` uses a Node environment,
loads `tests/setup.ts`, and discovers `.unit.test` and `.e2e.test` files through
the script filters in `package.json`.

- `tests/unit/alarms.unit.test.ts` is the only unit-test file. It mocks
  `webextension-polyfill` and `prManager` and checks listener registration plus
  a non-throwing periodic-alarm path.
- `tests/extension.e2e.test.ts` drives the built Chrome extension popup through
  Puppeteer. It covers the main authentication flow and a set of dashboard
  interactions and visual assertions.
- `tests/screenshot.e2e.test.ts` populates the extension and captures light and
  dark screenshots. It is primarily artifact/visual support rather than a
  comprehensive behavioural oracle.
- `tests/setup.ts` launches Chrome with `.output/chrome-mv3`, discovers the
  extension ID, opens popup pages, and closes the shared browser.
- `tests/test-data.ts` injects encrypted PR/application data in the extension
  page for repeatable popup scenarios.
- `tests/types.ts` validates that the E2E token environment variable is present;
  `tests/utils.ts` supplies a delay helper.

The E2E suite currently loads `GITHUB_TOKEN` from `.env.test` and performs live
GitHub token/scope validation before injecting local test data. It therefore is
not fully isolated from GitHub or suitable for every developer environment.

## Current coverage summary

Unit coverage is minimal and focused on alarm listener setup. There are no
focused unit tests for GitHub response mapping, HTTP error classification,
filtering and sorting, secure storage, authentication decisions, polling,
notification decisions, or duplicate prevention.

The Chrome popup E2E suite meaningfully exercises authentication with a live
token, populated rendering, some filtering/sorting/search/theme interactions,
refresh, and hidden-PR persistence across a popup reload. Other assertions are
broad, conditional, or inspect only the presence of generic elements. For
example, the test named for the notification toggle selects the first checkbox,
while the actual notification control is a button, so it does not establish
targeted notification-preference coverage.

The fixture data avoids live PR contents after authentication, but it currently
uses `Date.now()` and `Math.random()` for ages and reviewer selection. Future
test work should use a fixed clock and fixed reviewer assignments where exact
ordering or output matters.

## Unit versus E2E

Use unit tests for rules that can be evaluated without a real browser:

- GitHub response transformation and deduplication;
- HTTP/status/error classification;
- PR filtering, text matching, and sorting;
- review and CI status reduction;
- refresh and notification eligibility;
- old/new PR comparison and duplicate prevention; and
- preference/default/validation decisions.

Use E2E tests where extension integration is the behaviour under test:

- popup screen transitions and user input;
- popup/background runtime messaging;
- storage persistence across popup or extension lifecycle events;
- alarms and notifications as browser-observable effects;
- external-link actions; and
- packaged Chrome and Firefox startup behaviour.

Use both when a critical rule has a pure decision core and browser wiring. Unit
tests should exhaust the decision table; a smaller E2E scenario should prove
that the UI, background context, storage, and browser APIs are connected.

## Deterministic tests and GitHub fixtures

- Freeze or inject time for age buckets, refresh throttles, notification
  throttles, and password expiry.
- Use fixed identifiers, timestamps, reviewers, and ordering in fixtures. Seeded
  data is acceptable when variation is intentional and reproducible.
- Await observable state or events instead of relying on arbitrary delays where
  practical.
- Isolate browser storage for each test or explicitly document scenarios that
  intentionally share state.
- Assert the feature-specific control and outcome. Avoid conditional tests that
  silently pass when the target control is absent.
- Mock GitHub endpoints for normal, empty, paginated, permission, rate-limit,
  malformed-response, and server-error cases when live state is not the subject
  of the test.
- Keep sanitized GitHub response fixtures representative of the API shapes used
  by `api.ts`. Never put tokens or private repository data in fixtures.
- Reserve live GitHub calls for a separately identified integration check, with
  explicit credentials and failure expectations.
- Do not make tests depend on public repository activity, current PR contents,
  network timing, locale-specific clock output, or test execution order.

## Initial coverage matrix

“Today” describes meaningful observable coverage, not just incidental execution.

| Area                                  | Primary level | Meaningful coverage today | Baseline note                                                                                                                                                                       |
| ------------------------------------- | ------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication/token validation       | Both          | Partial E2E               | The main E2E flow submits a live token and reaches the dashboard; invalid/revoked/network cases have no focused coverage.                                                           |
| GitHub permission/scopes handling     | Both          | Partial E2E               | Successful `repo` scope is traversed by live authentication, but missing-scope behaviour is not asserted.                                                                           |
| GitHub API error handling             | Unit          | No                        | `analyzeHttpError` and popup/notification propagation lack focused tests.                                                                                                           |
| PR data transformation                | Unit          | No                        | Detail mapping, defaults, review/CI reduction, and deduplication are untested directly.                                                                                             |
| PR filtering/review-request detection | Both          | Partial E2E               | A draft filter and rendered review states are exercised broadly; authored/review-request search construction and filter decision tables are not tested.                             |
| Repository information                | Both          | Partial E2E               | Injected repository names are asserted in populated rendering; mapping and link correctness are not.                                                                                |
| Background polling                    | Both          | No                        | The alarm unit test does not establish fetch, persistence, badge, or scheduling behaviour.                                                                                          |
| Alarms                                | Both          | Minimal unit              | Listener registration and a non-throwing periodic path exist; creation, password restoration/expiry, and browser lifecycle behaviour do not.                                        |
| Notification decisions                | Unit          | No                        | New-PR, first-run, error, and force-show decisions are untested.                                                                                                                    |
| Notification preference handling      | Both          | No                        | A named E2E test targets a checkbox rather than the notification button; persistence and delivery suppression are not established.                                                  |
| Duplicate-notification prevention     | Unit          | No                        | Snapshot comparison and both in-memory throttles have no focused coverage.                                                                                                          |
| Settings/storage persistence          | Both          | Partial E2E               | Hidden PR state persists across popup reload; encrypted token/data, filters, sort, custom query, theme, and notification persistence lack focused coverage.                         |
| Popup loading state                   | E2E           | No                        | Popup loading is traversed but the loading state and transition are not asserted.                                                                                                   |
| Popup empty state                     | Both          | No                        | The `No pull requests found` rendering has no focused test.                                                                                                                         |
| Popup populated state                 | E2E           | Yes                       | Injected PR titles, repositories, cards, avatars, and several status representations are exercised.                                                                                 |
| Popup error handling                  | Both          | No                        | Login errors and `SHOW_ERROR` dashboard behaviour are not meaningfully asserted.                                                                                                    |
| Links/actions                         | E2E           | Partial                   | Refresh and hide/unhide are exercised; PR/external link targets and sign-out/reset flows are not fully covered.                                                                     |
| Extension startup/reload behaviour    | E2E           | Partial                   | Extension loading and popup reload with hidden-state persistence are covered; background restart, remembered-password restore/expiry, reinstall, and full extension reload are not. |
| Chrome build                          | Build check   | Yes                       | `npm run build` is used by E2E and `build:all`; CI builds Chrome. This is build compatibility, not full runtime coverage.                                                           |
| Firefox build                         | Build check   | Yes                       | CI runs `npm run build:all`, including Firefox. There is no Firefox browser E2E suite.                                                                                              |

## Critical E2E journeys to establish

The following are the eventual critical journeys; add them incrementally in
focused testing work rather than as incidental additions:

1. First install, valid token with required scope, password creation, encrypted
   persistence, and populated dashboard.
2. Invalid token, missing scope, expired/revoked token, rate limit, network
   failure, and recovery.
3. Remembered-password startup, background restart, 12-hour expiry, sign-out,
   and reset.
4. Empty, populated, loading, and error popup states.
5. Manual and alarm-driven refresh through GitHub fixtures, encrypted storage,
   badge update, and popup update.
6. Notification opt-in/out, first-run policy, new-PR detection, duplicate
   prevention, and browser notification delivery.
7. Filter, sort, search, custom query, hide/unhide, theme, and preference
   persistence after reload.
8. PR and external actions opening the correct safe URL.
9. Extension startup and core popup flow in both Chrome and Firefox.

## Regression workflow

1. Reproduce the defect with the smallest reliable case.
2. Add a failing unit test for the underlying decision whenever practical.
3. Add or update a focused E2E test if browser integration or a critical user
   journey is involved.
4. Implement the smallest fix without weakening existing assertions.
5. Run the focused test, then `npm run test:unit` and the proportionate build and
   E2E checks from `AGENTS.md`.
6. Record pre-existing failures separately from failures introduced by the
   change, and document any environment-limited check in the PR.
