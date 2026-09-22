# Testing guide and baseline

This document describes the test system and observable coverage on the branch
where this baseline was created. It does not claim coverage merely because a
feature exists or a test has a broad name.

## Current tooling and layout

Vitest `5.0.0` is the test runner. `vitest.config.ts` is the browser-free unit
configuration and uses a Node environment. `vitest.e2e.config.ts` extends it
with the packaged-browser setup used only by E2E and screenshot runs. Test
files are selected through the script filters in `package.json`.

- `tests/unit/` contains focused coverage for authentication, secure storage,
  preferences, GitHub response mapping and errors, background sessions,
  polling, alarms, and notifications.
- `tests/e2e/` contains the required deterministic Chrome journeys, split into
  authentication, popup states, preferences, refresh, and lifecycle suites.
- `tests/e2e/harness.ts` seeds the real encrypted extension-storage format and
  intercepts only GitHub API requests from the popup and MV3 service worker.
- `tests/e2e/fixtures.ts` supplies fixed tokens, timestamps, users, reviewers,
  repositories, statuses, and pull requests.
- `tests/screenshot.e2e.test.ts` populates the extension and captures light and
  dark screenshots. It remains an optional live-token visual-artifact command,
  not a behavioural oracle or part of the required E2E suite.
- `tests/e2e/setup.ts` launches Chrome with `.output/chrome-mv3-test`, discovers
  the extension ID, opens popup pages, and closes the worker-owned browser.

`npm run test:e2e` and `npm run test:headless` require no GitHub credentials or
public-network access. They build in Vite `test` mode, exercise token validation
with popup request interception, and exercise refresh/error integration by
intercepting the packaged service worker's `api.github.com` requests through
the Chrome DevTools Protocol. Normal production builds do not contain the
test-only background-state reset message handler.

Unit workers never load Puppeteer setup. The current unit suites use mocked
browser boundaries or pure TypeScript and therefore launch no Chrome process.
E2E workers own the browser instances they need and close them in global
teardown, including after failed tests.

## Current coverage summary

The unit suite covers the underlying decisions and transformations. The smaller
browser suite proves the packaged popup, background messaging, encryption,
storage, and UI boundaries are connected. It covers login and password
transitions, missing scope and invalid token errors, remembered sessions,
loading/empty/populated/error states, notification/filter/sort/query/theme and
hidden-state persistence, manual refresh persistence, sign-out/reset, popup
close/reopen/reload, and critical link targets.

The manual-refresh E2E coverage also verifies that one failed canonical PR
detail request preserves the encrypted cached and notification-comparison
snapshots, and that the next complete refresh recovers normally.

Behavioural fixtures contain no `Math.random()`, uncontrolled fixture time,
live GitHub data, or arbitrary test delays. Screenshot demo fixtures remain
separate and may vary because they are not regression assertions.

## Unit versus E2E

Use unit tests for rules that can be evaluated without a real browser:

- GitHub response transformation and deduplication;
- HTTP/status/error classification;
- complete-refresh rejection for failed or unusable required PR details while
  optional review and CI data degrade to `pending`;
- bounded per-PR scheduling, including barrier-controlled concurrency,
  input/result ordering, rate-limit stop-scheduling, optional degradation, and
  clean recovery after failures without timing sleeps;
- session-generation invalidation at paused `/user`, pagination, and bounded
  worker boundaries, including no queued requests or late side effects and a
  new session refreshing while the retired operation settles;
- issue-search pagination, including later-page failures, incomplete results,
  zero results, duplicate hits, and the 1,000-result API ceiling;
- GitHub rate-limit classification, deadline precedence, persisted cooldown
  restoration, active-refresh suppression, expiry, and successful recovery;
- optional review/CI rate limits retaining `pending`, selecting the latest
  deadline, persisting a successful complete snapshot, and suppressing the
  subsequent refresh without retrying the current one;
- endpoint-specific request counts, including canonical-detail reuse and
  pre-detail deduplication of matching search results;
- PR filtering, text matching, and sorting;
- review and CI status reduction;
- refresh and notification eligibility;
- popup refresh/query completion, rejected runtime messages, cooldown/error
  completion without `DATA_UPDATED`, and loading cleanup without fixed delays;
- storage-authoritative popup reloads, semantic-only `DATA_UPDATED`, and
  serialized trailing reload coverage for distinct committed changes;
- old/new PR comparison, successful snapshot advancement despite notification
  throttling or delivery failure, durable pending-ID migration and accumulation,
  current-snapshot pruning, grouped one-time replay, hidden-PR eligibility,
  throttle/API-failure retry, and duplicate prevention;
- sign-out cleanup acknowledgement, guarded encrypted writes, notification
  cancellation, pending replay after password-only unlock, and rejected lock
  responses remaining on the authenticated popup; and
- preference/default/validation decisions.

Use E2E tests where extension integration is the behaviour under test:

- popup screen transitions and user input;
- popup/background runtime messaging;
- storage persistence across popup or extension lifecycle events;
- alarms and notifications as browser-observable effects;
- notification preference disable/discovery/re-enable replay across popup
  reopen, including one grouped browser notification and no later duplicate;
- explicit sign-out during a paused automatic background request, proving the
  popup locks before the response is released, remembered state is removed,
  no later GitHub request or browser/storage side effect occurs, and password-
  only unlock can refresh with the retained encrypted PAT;
- external-link actions; and
- packaged Chrome and Firefox startup behaviour.

Use both when a critical rule has a pure decision core and browser wiring. Unit
tests should exhaust the decision table; a smaller E2E scenario should prove
that the UI, background context, storage, and browser APIs are connected.

Shared UI primitives use component-level unit coverage for variants, semantic
classes, native disabled and accessibility attributes, slot composition, and
reduced-motion behavior. The test-build-only design-system showcase provides a
packaged-popup fixture for generated CSS, light/dark token scopes, keyboard
focus, and keyboard activation. It is not a production screen and must remain
guarded by the WXT/Vite `test` mode.

## Deterministic tests and GitHub fixtures

- Freeze or inject time for age buckets, refresh throttles, notification
  throttles, and password expiry.
- Use fixed identifiers, timestamps, reviewers, and ordering in fixtures. Seeded
  data is acceptable when variation is intentional and reproducible.
- Use deferred promises or explicit barriers to control concurrency tests;
  assert which work has started before releasing capacity rather than waiting
  for arbitrary time intervals.
- Await observable state or events instead of relying on arbitrary delays where
  practical.
- Isolate browser storage for each test or explicitly document scenarios that
  intentionally share state.
- Close popup pages after each E2E scenario and detach GitHub request handlers
  after each E2E file, including failure paths.
- Before seeding a fresh E2E scenario, await the test-only background reset,
  then clear local/session storage, alarms, and visible notifications. The
  reset clears manager refresh/notification timestamps, the manual-refresh
  timestamp, and the notification module's per-key throttle. It refuses to run
  while a refresh is active rather than cancelling that work.
- Keep persistence journeys inside one scenario when they deliberately cross a
  popup close/reopen or reload boundary; scenario cleanup must not run between
  those steps.
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

## Legacy E2E assertion migration

The former `tests/extension.e2e.test.ts` mixed state across one popup and used a
live token. Its meaningful assertions map as follows:

| Former coverage                                                                                  | Focused replacement                                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Extension/popup loads and authentication succeeds                                                | `authentication.e2e.test.ts` initial and full setup journeys                                   |
| Injected titles, repositories, authors, avatars, reviewer overflow, draft, review, and CI states | `popup-states.e2e.test.ts` populated-state journey                                             |
| Draft filtering and title search                                                                 | `preferences.e2e.test.ts` persisted draft filter and `popup-states.e2e.test.ts` focused search |
| Sorting, custom query, theme, and hidden PR persistence                                          | `preferences.e2e.test.ts`                                                                      |
| Manual refresh                                                                                   | `refresh.e2e.test.ts`, including message-path requests and encrypted persistence               |
| Popup reload                                                                                     | `preferences.e2e.test.ts` and `lifecycle.e2e.test.ts`                                          |

The former notification test clicked the first checkbox (the Drafts filter), so
it was false coverage; the replacement targets the notification button by its
specific accessible label and proves encrypted persistence after reload.
Conditional theme/search/status checks, generic icon/element counts, the debug
target test, and assertions about the injector's own object shape were removed
because they could pass without proving the named user behaviour. Their useful
intent is covered by direct state and user-visible assertions above.

## Browser scope and remaining gaps

- Required runtime E2E runs packaged Chrome MV3 locally and in GitHub Actions.
- Firefox MV2 is still build-verified, but the current Puppeteer harness does
  not provide Firefox extension runtime E2E.
- Popup close/reopen/reload and remembered-session restoration are covered.
- Deliberately terminating/restarting the MV3 service worker is not covered;
  doing so reliably with the current harness would require fragile Chrome
  internals. Background restart/session restoration and persisted GitHub
  cooldown restoration remain protected at unit level.
- Screenshot capture remains opt-in and live-token based. It is not run in CI.

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
