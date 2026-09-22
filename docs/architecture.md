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

### UI design system and theme architecture

New shared UI is built from source-owned shadcn/ui-style primitives under
`src/components/ui/`. `components.json` configures the shadcn CLI for the
existing WXT/Tailwind v4 application; it uses the repository's `@/*` alias and
the popup stylesheet rather than introducing a separate Vite application.
Generic primitives must remain independent of GitHub models, extension APIs,
and popup orchestration.

`src/styles/tokens.css` is the authoritative source for new semantic tokens.
It defines light and dark values for surfaces, text, actions, borders, focus,
destructive actions, radii, compact typography/spacing, and separate CI and
review statuses. Tailwind exposes those values through `@theme inline`, so new
code should prefer classes such as `bg-card`, `text-foreground`, and
`border-border` over palette-specific utilities. CI and review state remain
separate concepts even when they share a visual colour.

The original production appearance also has popup-scoped semantic values in
that same file (`--popup-*`). They preserve its compact white/charcoal surfaces,
purple/green primary actions, solid CI/review labels, neutral card rails, and
coloured age text without changing generic primitive defaults. The production
compatibility selectors in `src/theme.css` are limited to `.screen-prlist` and
`.screen-auth`; they do not apply to the test-only shared component showcase.
The dark search and custom-query fields intentionally use the original
card-coloured surface, not the newer darker input token.

Production text/password/search inputs, ordinary action buttons, CI/review
badges, filter surfaces, PR card surfaces, authentication surfaces, and the
full-reset dialog now compose those primitives and semantic utilities. Native
selects and checkboxes retain their platform semantics while using token-backed
classes. Review and CI badges deliberately use separate variants and data.

`src/theme.css` is a transition layer for the purpose-built notification
switch, shared error banner, root/link defaults, and narrowly scoped original
popup treatment. The former
duplicate colour variables, palette badge classes, broad element overrides,
and unused starter selectors were removed after their consumers migrated.
`entrypoints/popup/style.css` still owns compact spacing and Chrome/Firefox
popup sizing. Its zero-specificity `:where(:not([data-slot]))` compatibility
guards remain so those rules cannot leak into shared primitives. These sizing
and density rules remain legacy because changing them requires dedicated
cross-browser visual validation.

The existing `theme-preference` storage key and `light`, `dark`, and `auto`
values remain unchanged. Popup bootstrap resolves and applies that preference
before React mounts, then `useTheme` owns subsequent selection changes. The
resolved light or dark theme is applied only as `data-theme` on the root
element. In automatic mode, a media-query listener updates the resolved theme
when the operating-system preference changes; selecting automatic after mount
also installs that listener. No provider or second persistence path exists.

Current boundary note: filtering, sorting, search, preference persistence, and
browser messaging are combined in `usePullRequests`. Token validation also
fetches GitHub directly from `useAuth`. Pure domain decisions should gradually
move to framework-independent functions when those areas are changed, but this
document does not prescribe an unscoped rewrite.

Manual refresh and custom-query actions use the existing `CHECK_PRS`
request/response boundary as their completion signal. The background responds
only after its serialized refresh (or immediate cooldown suppression) settles;
the popup then clears loading in structured cleanup. Encrypted app-data storage
changes are the authoritative popup reload signal, so failed or cooldown-
suppressed refreshes do not manufacture a read. `DATA_UPDATED` remains a
semantic notification without duplicating the storage-driven reload. Popup
loads are serialized locally, with at most one trailing pass when another
committed storage change arrives during an active decrypt, so later states are
not lost and decrypt work never runs in parallel.

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
- `state.ts` holds process-local session password, lock/generation state, and
  refresh/notification throttle state plus timing constants.

The background process may be stopped and recreated by the browser. Session
password state is therefore restored from `browser.storage.session` when the
background context starts. In-memory refresh and notification throttle values
do not survive a background restart.

An explicit sign-out is a session lock, not account deletion. The background
increments a session generation and aborts the generation's active refresh
before clearing its in-memory password. Each refresh owns an `AbortController`
and captures its starting generation. A refresh whose generation is no longer
current cannot dispatch another GitHub request, report an API error, update the
badge, write current or comparison PR state, persist its cooldown result,
notify the popup, or create a notification. Its detached in-flight bookkeeping
also cannot clear or be reused by a newly unlocked session. Sign-out awaits
remembered-session removal, refresh/expiry alarm cleanup, and any app-data
mutation already submitted before it acknowledges success. The encrypted PAT,
encrypted application data, and preferences remain available for the next
password-based unlock.

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

Session invalidation is separate from required-failure and rate-limit
scheduling. The refresh session signal is passed through `/user`, paginated
search, required details, reviews, checks, and combined-status requests.
Invalidation aborts active fetches and is checked after asynchronous response
or JSON work and before each later page, queued PR unit, optional request, or
error side effect. It settles silently rather than being classified as a
GitHub failure. This does not change the existing decision to let a default
search peer continue merely because its sibling encountered a rate limit.

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
contains current and previous PR snapshots, pending new-PR notification IDs,
plus preferences such as filters, sort order, custom query, and notification
enablement. Pending IDs remain inside the encrypted application-data envelope;
older records without that field normalize it to an empty list.

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
Refresh-owned mutations carry a generation-validity guard that runs before
decrypting, after mutation work, and immediately before the encrypted storage
commit. Session cleanup can await the mutation queue, preventing an old
session's submitted write from completing after sign-out acknowledgement.

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
snapshot, compares it with `oldPullRequests`, and records genuinely new,
notification-eligible PR IDs. The same serialized mutation advances
`oldPullRequests`, prunes pending IDs that are absent from the latest complete
snapshot, and merges new IDs without duplication. This happens for every
complete, trustworthy refresh, including when display is throttled, disabled
by preference, or fails. Failed and cooldown-suppressed refreshes preserve both
snapshots and the pending set.

Pending delivery is serialized separately from refresh execution and reads the
latest encrypted current snapshot. It groups all still-relevant pending IDs in
the existing notification format. Re-enabling notifications, restoring an
authenticated remembered session, password unlock, and a successful refresh
are safe replay opportunities; preference re-enablement does not require a
GitHub request. Pending IDs are removed only after the browser notification API
accepts the notification. Preference suppression, either throttle, API
rejection, or session invalidation retains them for a later opportunity. Replay
uses the active session generation, so a locked session cannot decrypt data,
display, or commit delivery state. Hidden PRs remain eligible.

First-run notifications are off unless the separate local flag is enabled.
An empty historical comparison snapshot therefore does not seed pending replay
state unless that flag opted into first-run delivery. New-PR notifications
respect the encrypted notification preference. Error notifications can be
forced for selected authentication/session failures. The notification helper
reports displayed, preference-disabled, throttled, failed, and invalidated
outcomes so only browser-accepted delivery clears pending state. Duplicate
delivery is also limited by manager state and an in-memory key/time map in
`notifications.ts`; those guards reset when the background context is
restarted.

Full Reset is coordinated by the background context so it can first invalidate
the active session and await queued encrypted-data mutations. It then removes
credentials, encrypted PR data and preferences, hidden IDs, rate-limit state,
first-run notification state, active notifications, badge state, and in-memory
refresh/notification throttles. The independent `theme-preference` local
storage value is intentionally retained.

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
