# Engineering guidance for PR Tracker

This file is the authoritative working agreement for coding agents in this
repository. Read it before changing code, tests, dependencies, build tooling,
or documentation. The supporting descriptions of the current system are in
[`docs/architecture.md`](docs/architecture.md),
[`docs/testing.md`](docs/testing.md), and
[`docs/development.md`](docs/development.md).

## Project purpose

PR Tracker is a client-side browser extension for tracking GitHub pull requests
that require the user's attention. It supports Chrome and Firefox. Do not
introduce a backend or external persistence service unless a task explicitly
requires an architectural change and that change has been approved.

## Current core stack

The checked-in `package.json` and lockfile are the source of truth. At the time
this guidance was written, the relevant declared versions are:

| Area                | Current package or configuration                               |
| ------------------- | -------------------------------------------------------------- |
| Extension framework | WXT `^0.21.4` with `@wxt-dev/module-react` `^1.2.2`            |
| UI                  | React and React DOM `^19.2.3`                                  |
| Language            | TypeScript `^7.0.2`                                            |
| Bundler             | Vite `^7.3.0`, used through WXT                                |
| Runtime             | Node.js 24 LTS                                                 |
| Package manager     | npm with `package-lock.json`                                   |
| Tests               | Vitest `5.0.0`                                                 |
| E2E                 | Puppeteer `^25.11.0`, `vitest-puppeteer` `^11.0.3`, and Vitest |
| Linting             | Oxlint `^1.83.0` with native TypeScript and React rules        |
| Formatting          | Prettier `^3.7.4` and `sort-package-json` `^3.6.0`             |
| Git hooks           | Husky `^9.1.7` and lint-staged `^16.2.7`                       |

Do not upgrade any of these as part of an unrelated change.

## Repository architecture

- `entrypoints/` contains the WXT background and popup entrypoints.
- `src/background/` contains GitHub fetching, polling coordination, alarms,
  notification delivery, badge updates, and background state.
- `src/components/` contains popup React presentation components.
- `src/hooks/` coordinates popup authentication, pull-request state and
  preferences, and theme state.
- `src/services/` contains encrypted browser-storage operations, storage
  validation schemas, and theme persistence.
- `src/utils/` contains shared utilities.
- `src/types.ts` contains shared application and GitHub data types.
- `tests/` contains Vitest setup, Puppeteer E2E scenarios and fixtures, plus
  unit tests under `tests/unit/`.

Keep WXT entrypoints thin where practical. Reusable application and business
logic belongs in focused, testable modules rather than in entrypoint wiring.

## Architecture rules

Agents must:

- preserve the client-only extension architecture unless explicitly instructed
  otherwise;
- support both Chrome and Firefox;
- avoid coupling reusable business logic directly to React or browser APIs when
  a clean abstraction is practical;
- keep GitHub API concerns separate from UI rendering concerns;
- centralise shared domain behaviour rather than duplicating it;
- prefer pure functions for filtering, transformation, comparison, and decision
  logic;
- keep browser storage access behind clear boundaries where practical;
- keep notification decision logic independently testable;
- avoid large unrelated refactors while implementing scoped tasks; and
- not silently introduce new architecture patterns. Explain and obtain approval
  for a material architectural change.

Some current code does not yet meet every desired boundary. In particular,
popup hooks contain filtering and persistence orchestration, and GitHub/API
error handling is coupled to browser messaging and notifications. Treat the
rules above as the direction for small, approved improvements, not permission
for an unrelated refactor. See `docs/architecture.md` for the current-state
details.

## Dependency rules

Agents must:

- not introduce a dependency unless it materially improves the solution;
- first check whether the existing stack or browser/WXT APIs already solve the
  problem;
- explain significant new dependencies and their tradeoffs in the pull request;
- avoid dependency upgrades while implementing unrelated features;
- perform major dependency upgrades separately; and
- consider Chrome and Firefox compatibility before adopting browser-specific
  APIs.

## Testing rules

Agents must:

- run the existing test suite before significant changes when practical;
- preserve existing behaviour unless the task explicitly changes it;
- add or update tests for behaviour changes;
- add regression tests for bugs;
- never delete, weaken, skip, or loosen a test solely to make a change pass;
- prefer unit tests for business logic;
- use E2E tests for critical extension and user workflows;
- keep tests deterministic;
- avoid depending on live GitHub state when fixtures or mocks can accurately
  exercise the behaviour; and
- distinguish pre-existing failures from failures introduced by the task.

Follow the coverage guidance and current baseline in `docs/testing.md`.

## Required verification

Use the scripts that exist in `package.json`:

| Check              | Command                 |
| ------------------ | ----------------------- |
| Compile/type-check | `npm run compile`       |
| Lint               | `npm run lint`          |
| Check formatting   | `npm run check-format`  |
| Unit tests         | `npm run test:unit`     |
| E2E tests          | `npm run test:e2e`      |
| Chrome build       | `npm run build`         |
| Firefox build      | `npm run build:firefox` |

`npm run test:all` runs unit and E2E tests, while `npm run build:all` builds both
browsers. The E2E script builds the Chrome extension before running Puppeteer.
It also currently requires the local E2E prerequisites documented in
`docs/development.md`. Choose checks proportionate to the change and report any
check that could not run. There is no `verify` script today; if one is added,
update this document at that time.

## Git and pull-request workflow

- `main` is protected. Never commit directly to `main`.
- Make every change on a dedicated branch.
- Merge every change through a pull request.
- Required CI checks must pass before merge.
- Keep pull requests focused on one concern.
- Do not combine dependency upgrades, architecture refactors, and feature work
  without explicit approval.
- Agents must not merge their own pull request unless explicitly instructed.

Preserve unrelated local work. Review the complete diff before committing, and
do not rewrite or discard changes that are outside the assigned task.

## Change discipline

For each task:

1. Inspect the relevant implementation first.
2. Understand the existing behaviour.
3. Identify affected tests.
4. Make the smallest coherent change.
5. Add or update tests when behaviour changes.
6. Run proportionate verification.
7. Report what changed, what was tested, and any remaining risks.
