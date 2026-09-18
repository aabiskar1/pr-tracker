# Current architecture

This document records the architecture that exists today. It is a baseline for
future work, not a proposal to redesign the extension.

## System overview

PR Tracker is a client-only WXT browser extension. A React popup provides the
user interface, and a background context polls GitHub, persists encrypted data,
updates the toolbar badge, and creates desktop notifications. All durable state
is held in browser extension storage; GitHub is the only remote application
service used at runtime. There is no PR Tracker backend.

WXT produces a Chrome Manifest V3 build and a Firefox Manifest V2 build from the
same source. `wxt.config.ts` declares storage, notifications, and alarms
permissions plus access to `https://api.github.com/*`.

## Extension entrypoints

`entrypoints/popup/main.tsx` is a thin popup bootstrap: it loads popup styling
and mounts `src/App.tsx` under React `StrictMode`.

`entrypoints/background.ts` registers the WXT background context. It currently
does more than bootstrap wiring: it restores remembered-password state,
registers install and runtime-message listeners, creates alarms, updates the
initial badge colour, and handles authentication/session and first-run
notification messages.

Desired direction: keep both entrypoints focused on lifecycle and message
wiring. Move reusable decisions into typed, independently testable modules when
a scoped change justifies doing so. This is not a mandate to refactor the
background entrypoint opportunistically.

## Popup and UI layer

`src/App.tsx` selects the loading, token login, password setup, password entry,
or authenticated dashboard screen. It composes three stateful hooks:

- `useAuth` determines authentication state, validates the GitHub token and its
  `repo` scope, coordinates encryption setup, and exchanges runtime messages
  with the background context.
- `usePullRequests` reads encrypted PR data and preferences, listens for runtime
  messages and storage changes, filters and sorts PRs, persists settings, hides
  or unhides PRs, and requests refreshes.
- `useTheme` loads, applies, and persists the light/dark/automatic theme.

Components under `src/components/` render the authentication screens,
dashboard controls, filters, empty state, and PR cards. PR links open GitHub in
a new tab. `src/utils/dateUtils.ts` supplies age colouring, while relative-time
formatting currently remains inside `PullRequestList.tsx`.

Current boundary note: filtering, sorting, search, preference persistence, and
browser messaging are combined in `usePullRequests`. Token validation also
fetches GitHub directly from `useAuth`. Pure domain decisions should gradually
move to framework-independent functions when those areas are changed, but this
document does not prescribe an unscoped rewrite.

Manual refresh and custom-query actions use the existing `CHECK_PRS`
request/response boundary as their completion signal. The background responds
only after its serialized refresh (or immediate cooldown suppression) settles;
the popup then reloads encrypted storage and clears loading in structured
cleanup. `DATA_UPDATED` and storage-change listeners remain supplementary UI
reload triggers rather than prerequisites for ending the requested operation.

## Background and service-worker layer

The background context is split across `entrypoints/background.ts` and
`src/background/`:

- `alarms.ts` registers handlers for five-minute PR checks and the 12-hour
  remembered-password expiry, and creates the periodic alarm.
- `prManager.ts` coordinates refresh throttling, token decryption, current-user
  lookup, PR fetching, badge updates, encrypted persistence, popup update/error
  messages, hidden-PR restoration, and new-PR notification decisions.
- `api.ts` queries GitHub and maps results into the shared `PullRequest` model.
  It also classifies HTTP errors and currently sends UI messages through a
  notification callback and `browser.runtime`.
- `githubRateLimit.ts` derives structured cooldown metadata from recognized
  rate-limit responses and persists the current GitHub cooldown separately
  from encrypted application data.
- `notifications.ts` reads the encrypted notification preference, throttles
  repeated notifications in memory, creates browser notifications, and handles
  the Chrome/Firefox badge API difference.
- `state.ts` holds process-local session password and refresh/notification
  throttle state plus timing constants.

The background process may be stopped and recreated by the browser. Session
password state is therefore restored from `browser.storage.session` when the
background context starts. In-memory refresh and notification throttle values
do not survive a background restart.

## GitHub API and data access

The extension authenticates with a user-supplied GitHub token. The popup first
calls `GET /user` to validate the token and checks the `x-oauth-scopes` response
header for `repo`. Background refreshes call `/user` again, then either:

- run separate GitHub issue searches for open PRs authored by the user and open
  PRs requesting that user's review; or
- run the saved custom issue-search query.

Each issue-search query is fetched sequentially in 100-result pages before any
per-PR requests begin. Pagination stops when the first page's `total_count` has
been collected or at GitHub's documented 1,000-result search ceiling (10
pages). An HTTP, network, invalid-JSON, malformed-response, or
`incomplete_results` failure on any page fails the complete refresh rather than
persisting a truncated result set.

The collected search results are deduplicated by canonical PR API URL before
per-PR requests begin. A reusable promise pool runs at most four per-PR work
units concurrently. This conservative product-level bound keeps several PRs
moving for responsive refreshes while avoiding unnecessary GitHub pressure; it
is intentionally independent of GitHub's changeable secondary-limit ceilings.
For every unique result, a work unit fetches and validates the full PR detail
response first, then reuses its repository URL and head SHA while fetching
reviews and check runs in parallel. If there are no check runs, it falls back
to the combined commit status. Bounding work units changes scheduling, not the
successful request count: the canonical detail endpoint is still called once
per unique PR rather than again during CI resolution. The canonical PR detail
response and the identity fields needed to construct a PR card are required:
if any such request fails or is unusable, optional requests for that PR do not
begin, the fetch returns an explicit failure, and the background manager
preserves the last known good snapshot. Review, check-run, and combined status
data remain optional and degrade to `pending`. When an optional failure is a
recognized rate limit, the work unit also retains its structured cooldown
metadata; ordinary optional failures retain no cooldown.

An ordinary required-detail failure preserves the complete evaluation behavior
for scheduled work. Once a required-detail rate limit is recognized, the pool
stops starting queued PRs because the refresh is already untrustworthy;
already-running work units settle without request cancellation. Rate-limit
metadata from those results still participates in the existing preferred
failure selection and persisted cooldown flow.

Recognized rate limits on required refresh requests (`/user`, issue search, or
canonical PR detail) record one conservative global GitHub cooldown in local
extension storage. `Retry-After` takes precedence over an exhausted
`x-ratelimit-reset`; recognized secondary limits otherwise use GitHub's
one-minute fallback guidance. Before `/user`, the background reads that
persisted state, silently suppresses automatic polling while it is active, and
reports the deadline to a manual caller while continuing to show cached data.
The MV3 worker does not sleep or retry in place. Expiry permits a normal
refresh. A success without a new rate limit clears the prior cooldown, while a
success containing optional rate-limit metadata persists the latest known
`nextAllowedAt` across all optional requests. That refresh still finishes all
bounded PR work units and persists the complete, trustworthy PR snapshot; the
cooldown suppresses only subsequent refreshes. This deliberately avoids
stopping queued work on an optional failure, which would leave incomplete PR
identity coverage.

Current boundary note: transport, response interpretation, transformation,
error notification, and browser messaging are not fully separated. Preserve
the behaviour, but prefer pure transformation/error-classification functions
and injectable transport or side-effect boundaries in future scoped work.

## Storage and settings

`src/services/secureStorage.ts` is the main browser-storage boundary. It uses
the Web Crypto API with password-derived AES-GCM keys. `browser.storage.local`
contains the encrypted GitHub token, encryption metadata/test vector, encrypted
application data, and separately encrypted hidden PR IDs. The application data
contains current and previous PR snapshots plus preferences such as filters,
sort order, custom query, and notification enablement.

The non-sensitive GitHub cooldown metadata is also stored in
`browser.storage.local` under its own key. It is deliberately outside the
encrypted PR snapshot so it can gate network work before token decryption and
survive background service-worker recreation.

Encrypted application-data writes are owned by the background context. Popup
preference and hidden-state actions send validated, operation-specific messages
to the background rather than writing a previously decrypted whole object.
`src/background/appDataStore.ts` serializes those mutations with refresh writes,
decrypts the latest persisted value for each queued operation, applies only the
owned fields, and re-encrypts the result. This single-writer boundary is needed
because popup and background modules execute in separate JavaScript contexts;
a module-local popup mutex would not coordinate with the service worker.

The user's encryption password is not persistently stored. When the user opts
to remember it, the password and flag are held in `browser.storage.session` and
cleared by a 12-hour alarm. The theme and the first-run notification flag are
plain local preferences. `storageSchemas.ts` uses Zod to validate selected
stored values before use.

Current boundary note: UI hooks still read encrypted application data directly
to render the popup. Keep writes routed through the background mutation owner,
keep storage access consolidated in services, and avoid spreading raw storage
keys or browser calls further.

## Alarms, polling, and notifications

Installation creates a periodic alarm, and setting a password creates it again.
The five-minute alarm checks PRs only when a session password is available or
can be restored. Automatic and manual refreshes have additional in-memory
throttles in `prManager.ts`.

After a successful fetch, the manager updates the badge, stores the current PR
snapshot, compares it with `oldPullRequests`, and optionally notifies for new
PRs. First-run notifications are off unless the separate local flag is enabled.
New-PR notifications respect the encrypted notification preference. Error
notifications can be forced for selected authentication/session failures.
Duplicate delivery is limited by both manager state and an in-memory key/time
map in `notifications.ts`; those guards reset when the background context is
restarted.

Desired direction: notification eligibility, snapshot comparison, first-run
behaviour, preference handling, and duplicate prevention should be expressible
as deterministic logic independent of the browser notification API.

## Shared types and utilities

`src/types.ts` defines GitHub response fragments, the normalized `PullRequest`,
encrypted application data/preferences, filter state, sort options, and theme
preferences. Some component-local filter type declarations duplicate these
shared types today. Centralise domain definitions rather than adding further
duplicates when touching that area.

## High-level data flow

1. The popup initializes and asks the background context whether a password is
   remembered; otherwise it inspects encrypted local storage to select the
   appropriate authentication screen.
2. A new token is validated against GitHub and encrypted with the user's
   password. The popup sends the password/remember choice to the background.
3. A popup action or periodic alarm asks `prManager` to refresh.
4. `prManager` decrypts the token, fetches and normalizes GitHub PR data, updates
   the badge, encrypts the new snapshot, evaluates notifications, and sends a
   `DATA_UPDATED` or `SHOW_ERROR` runtime message.
5. `usePullRequests` also watches encrypted storage changes. It decrypts the
   current data, merges separately stored hidden IDs, applies filters and sort
   order, and renders the dashboard.
6. Popup preference and hidden-state changes are sent as narrow mutation
   messages to the background, where they are serialized with refresh writes;
   refresh and custom-query actions are also sent to the background context.

## Chrome and Firefox portability

- Continue using WXT and `webextension-polyfill` rather than introducing raw,
  browser-specific access without a compatibility reason.
- The current Chrome build is Manifest V3 and uses `browser.action`; Firefox is
  built as Manifest V2 and may require `browser.browserAction`. Badge setup and
  updates already implement this fallback.
- Do not assume a persistent background process. Design state restoration and
  event handling for service-worker lifecycle interruptions.
- Validate changes in both `npm run build` and `npm run build:firefox`.
- Current Puppeteer E2E coverage runs only against the built Chrome extension;
  a successful Firefox build is not equivalent to Firefox runtime coverage.

## Boundaries to preserve

- Keep the product client-only unless an approved task changes that constraint.
- Keep GitHub transport/data-access concerns out of presentation components.
- Keep encryption and storage details behind service boundaries.
- Keep popup/background communication explicit and avoid hidden cross-context
  state assumptions.
- Keep shared transformations, filtering, comparisons, and notification
  decisions suitable for unit testing.
- Preserve Chrome and Firefox support together.
- Improve imperfect boundaries incrementally and only within the scope of an
  approved change.
