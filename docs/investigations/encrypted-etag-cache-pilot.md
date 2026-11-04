# Encrypted canonical-detail ETag pilot

## Decision and scope

**KEEP the bounded, detail-only pilot.** The validation below found authenticated
primary-quota and body-data savings, with a small measured local processing
cost. It does not establish typical hit rates or an end-to-end speed improvement.
Do not expand caching to other endpoints on this evidence. The implementation
changes no search, review, CI, filtering,
notification or encrypted application-snapshot semantics. Every discovered PR
still makes a canonical-detail HTTP request. The cache can save body bytes and
may save authenticated _primary_ rate-limit units on 304s, but cannot save HTTP
calls and has no demonstrated latency benefit. GitHub's [conditional-request
guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)
requires correct authorization for zero-primary-cost 304s; secondary limits
can still apply. PR #108 adds validation tooling and tests; production behaviour
and the extension version remain unchanged.

## Storage and identity

`detailCache.ts` owns only canonical PR detail entries. Each version-1 entry
contains a canonical ID and HTML URL, exact request key, ETag, a validated
minimal detail projection and update time. The projection retains only fields
used for PR mapping and CI location, omitting GitHub's PR body and other
unused response fields. The key includes `https://api.github.com`, the
exact canonical request URL and the current Accept representation. A SHA-256
scope digest of account login and token is stored **inside** the encrypted
envelope; the token itself is never stored in the cache or logged. Replacement
tokens and other accounts cannot reuse an old envelope even with the same
password. Token encryption, sign-out and Full Reset remove the cache keys.

`secureStorage.ts` derives the existing password/extension-ID/salt AES-GCM key
once for a cache load and potential write within an accepted refresh. It uses
a new random 12-byte IV per write. Ciphertext and IV live under separate
`browser.storage.local` keys, apart from the encrypted application data and
rate-limit cooldown. Base64 avoids the expansion from storing ciphertext as a
JSON number array; the plaintext metadata and body remain protected. Stored
envelopes undergo schema, identity, key, ETag, body-size and age validation
before use. Corrupt, unsupported or mismatched data is ignored; a fresh 200
can replace it. There is no plaintext persistent response cache.

Chrome MV3 worker termination and browser restart erase the in-memory working
map but not the encrypted local envelope. Firefox MV2 uses the same storage
API. Sign-out invalidates the refresh, waits for cache and app-data write
queues, then removes cache storage; Full Reset also removes the keys with all
account state. A retired refresh cannot finish a cache commit after reset
acknowledgement. Cache persistence occurs only after the complete encrypted
PR snapshot succeeds, so a required-detail failure retains the prior snapshot
and does not persist staged details. Optional failure semantics are unchanged.
A cache write failure is isolated from the successful snapshot.

## Request and eviction rules

An eligible entry adds `If-None-Match` to the normal authenticated detail GET.
A 304 reuses its exact saved body and passes it through required-detail mapping
again. A 200 is parsed and mapped before its minimal projection and valid ETag are staged.
A 200 without a usable ETag removes any prior entry for that request. A 304
without a matching valid body is a required-detail failure, never an empty
success. Other HTTP/network/JSON failures do not fall back to stale data.
Review pagination, check runs and combined-status fallback always execute
normally, including on the same SHA.

Entries expire after 24 hours. The limits are 100 entries, 64 KiB per detail
projection and 1 MiB total projections, with oldest-update eviction; the stored
base64 ciphertext is capped at 1.6M characters before decryption. The public
detail response sampled in PR #105 was about 18 KiB; the stored projection is
typically smaller. The single-entry ceiling skips unusually large reviewer
lists. The total
bound is deliberately conservative against Chrome's local-storage quota and
other encrypted app data. An oversized detail remains usable for that live
refresh; it simply is not cached. There is no migration: unknown cache
versions are discarded.

## Validation environment and method

Validation on 2026-11-04 started from `b5def95` on `main`, including merged
PRs #106 and #107. Local tools were Windows NT 10.0.26300, Node.js 22.14.0,
npm 10.9.2, Puppeteer 25.16.0, Chrome for Testing 156.0.8078.47 and installed
Firefox 159.0.1. Local Node differs from the supported Node 24 LTS; the GitHub
`verify` job uses Node 24. No dependencies or browser permissions were added.

Three kinds of evidence are kept separate:

- Authenticated, read-only HTTPS requests to GitHub measure actual status,
  primary-rate headers, response-body bytes and duration. They do not run a
  complete extension refresh.
- Packaged Chrome MV3 and Firefox MV2 tests run the real background refresh,
  Web Crypto, encrypted storage and lifecycle code with controlled transport.
  Their response statuses and bodies are fixtures, not live GitHub results.
- Unit tests inject corruption, expiry, failures and cancellation at repeatable
  boundaries. These establish correctness, not network performance.

The production cache's in-memory counters remain local to each refresh; no
telemetry or diagnostic logging was added to the extension.

## Authenticated GitHub results

The existing `.env.test` token failed the initial `/user` check with HTTP 401.
The already configured GitHub CLI credential succeeded. Neither credential,
account identity, response content nor raw ETag was printed or saved. No new
credentials were obtained and no PR was changed.

[`measure-detail-cache-live.mjs`](../../scripts/measure-detail-cache-live.mjs)
performs one `/user` GET, followed by three rounds over public merged PRs
#103–#107. Each round sends an unconditional detail GET followed by a GET of
the same URL with its returned `If-None-Match`. Requests are sequential with
250 ms between detail requests, use the production Authorization/Accept forms,
and request identity encoding. The script records only status, byte count,
timing and rate metadata. It stops on errors rather than retrying.

| Metric                                 | Unconditional detail | Matching conditional detail |
| -------------------------------------- | -------------------: | --------------------------: |
| Actual HTTP requests                   |                   15 |                          15 |
| HTTP 200 / 304                         |               15 / 0 |                      0 / 15 |
| Observed ETag hit rate                 |                    — |                15/15 (100%) |
| Primary remaining decrease per request |         1, in all 15 |                0, in all 15 |
| Primary used increase per request      |         1, in all 15 |                0, in all 15 |
| Total response-body bytes              |              281,919 |                           0 |
| Body bytes per response                |        17,613–20,750 |                           0 |
| Median duration                        |             292.9 ms |                    288.6 ms |
| Duration range                         |       254.7–401.1 ms |              259.9–332.3 ms |

There were 31 successful requests including `/user`, plus the earlier rejected
credential check. All detail samples reported the same core reset window, so
adjacent remaining/used differences were comparable. No unexplained changes
from other account activity appeared. The sample demonstrates 15 avoided
primary units and 281,919 avoided response-body bytes for those warm requests;
it saves **zero HTTP requests**. All responses used identity encoding, so these
are received body bytes, excluding headers, TLS and connection overhead. They
are not compressed browser wire-byte measurements.

This agrees with GitHub's [authorized conditional-request rule](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests).
It does not contradict PR #105's unauthenticated probe, whose 304s consumed
primary units. Secondary limits still apply. The overlapping durations and
small selected sample do not establish a latency improvement or a typical
hit rate: these were stable merged PRs, revisited immediately, not active
private repositories over days.

A live metadata-change/ETag-miss scenario was unavailable without modifying a
real PR. Expiry, absent ETags and corruption are local cache conditions, tested
with fixtures below; GitHub was not made to emit artificial responses for them.
Authenticated full-refresh timing and private-repository behaviour remain
unverified.

To repeat with an existing CLI credential in PowerShell:

```powershell
$env:PR_TRACKER_CACHE_LIVE = '1'
$env:PR_TRACKER_CACHE_CREDENTIAL = 'gh'
node scripts/measure-detail-cache-live.mjs
```

Omit the credential selector to use `GITHUB_TOKEN`, falling back to `.env.test`.
The command is opt-in and never runs in the ordinary test suite.

## Repeated Chrome fixture measurements

[`detail-cache-measurement.e2e.test.ts`](../../tests/e2e/detail-cache-measurement.e2e.test.ts)
runs five sequences of disabled, cold and unchanged warm refreshes, each with
40 PRs and one custom-search page. Transport returns immediate fixture
`Response` objects; each detail includes a 20,000-character unused body. The
real production manager, mapping, encryption and storage still run. Cache
disabled means the optional cache's scope digest is made to fail; its existing
failure boundary proceeds without a cache. Cold runs remove the cache keys;
warm runs load the envelope saved by the preceding cold run.

Timers wrap native Web Crypto and storage APIs without changing their results.
Load time runs from scope hashing to the first search request, including key
derivation, storage, decryption and entry validation. Encryption and storage
write times are reported separately and exclude JSON/base64 serialisation.
Full refresh time includes popup/background completion messaging and encrypted
snapshot/notification processing. Timing values are observations, not pass/fail
thresholds. Fixed execution order, instrumentation and local scheduling can
bias them. The table is from an isolated focused headless run; full-suite
timings vary with other browser tests running concurrently.

| Per-refresh metric (five samples per mode) | Cache disabled |           Cold |            Warm |
| ------------------------------------------ | -------------: | -------------: | --------------: |
| Requests to fixture transport              |            122 |            122 |             122 |
| Detail 200 / 304                           |         40 / 0 |         40 / 0 |          0 / 40 |
| Total decoded fixture-body bytes           |        883,963 |        883,963 |           8,150 |
| Encrypted cache base64 characters          |              0 |         90,432 |          90,432 |
| Median complete refresh                    |       214.0 ms |       228.8 ms |        224.4 ms |
| Complete refresh range                     | 211.1–217.8 ms | 225.7–236.1 ms |  217.0–229.8 ms |
| Median cache load                          |              — |        10.9 ms |         14.0 ms |
| Median cache PBKDF2 derivation             |              — |        10.0 ms |         10.0 ms |
| Median cache AES-GCM decrypt               |              — |              — |          0.2 ms |
| Median cache storage read                  |              — |         0.2 ms |          0.8 ms |
| Median cache AES-GCM encrypt               |              — |         0.1 ms | 0 ms (no write) |
| Median cache storage write                 |              — |         3.9 ms | 0 ms (no write) |

All 200 warm detail requests returned fixture 304s. Warm refreshes saved
875,813 decoded fixture bytes each (99.1% of this deliberately body-heavy
fixture), with no request reduction. The median warm refresh was 10.4 ms
slower than disabled (about 4.9%); cold was 14.8 ms slower. This is a measurable
local processing cost. It cannot predict net GitHub refresh latency, where
transferring and parsing the avoided bodies may offset that cost.

PR #105 modelled 128 requests and 326,119 decoded bytes for 40 PRs, with 62.1%
fewer bytes for a fully warm detail cache and no virtual latency saving. This
test uses one search, no extra review/check pages and different bodies, hence
122 requests and different bytes. It exercises production code and measures
local processing; #105 was a virtual endpoint simulator with no encryption.
The figures are not interchangeable. Both preserve independent review/CI
requests. The original #106 one-PR Node/Web Crypto sample measured about 19 ms
for cache load and 0.3 ms for write; it remains historical mock evidence only.

Repeat after `npm run build:e2e`:

```powershell
$env:CI = 'true'
npx vitest run --config vitest.e2e.config.ts --reporter=verbose tests/e2e/detail-cache-measurement.e2e.test.ts
```

## Chrome worker restart and Firefox runtime

The new [Chrome restart test](../../tests/e2e/detail-cache.e2e.test.ts) first
uses CDP-intercepted cold 200 and warm 304 responses. It then detaches the mock,
calls Puppeteer's service-worker `close()`, observes the old target's destruction,
wakes a new worker with runtime messaging and verifies a marker in the old
global scope is gone. This is an actual worker termination, not a module reset.
The first eligible refresh in the new worker uses the persisted ETag, rebuilds
the correct PR from a 304, and separately fetches reviews and same-SHA checks.
The encrypted cache and PAT are unchanged, the app snapshot decrypts correctly,
the badge stays `1`, and the notification inventory stays empty.

The installed Chrome's CDP Fetch interception missed requests after restart,
even when attached before script execution. `ServiceWorker.stopAllWorkers`
also did not destroy the attached extension worker. The passing test uses
Puppeteer's worker close API and controlled `fetch` in the new worker. It
therefore proves the lifecycle/storage/request-construction boundary, not a
native network 304 after restart. That combined live-browser case remains open.

The new [Firefox cache test](../../tests/firefox/detail-cache.firefox.test.ts)
installs the production MV2 build in an isolated real Firefox profile. It
verifies cold encrypted persistence, popup close/reopen, a matching conditional
304, approval and same-SHA failing-CI changes, sign-out clearing both cache
keys while retaining the encrypted PAT, and password unlock followed by cold
repopulation and Full Reset removing cache, PAT and app data. It respects the
production manual throttle. The existing Firefox toolbar/Advanced CI test also
passes.

Firefox BiDi interception does not see background-extension requests here.
The cache test uses a background `fetch` fixture bridge hosted by a separate
extension controller tab, kept open while the user popup closes and reopens.
Web Crypto, storage, Response handling and background messaging are native
Firefox code paths. Native Firefox HTTP/header handling, a genuine toolbar
popup cache journey, browser restart and closed-all-extension-page operation
are not established by this cache test. No Firefox performance claim is made.

Repeat after `npm run build:firefox`:

```powershell
npx vitest run --config vitest.config.ts --reporter=verbose tests/firefox/advanced-ci.firefox.test.ts tests/firefox/detail-cache.firefox.test.ts
```

## Correctness findings

No production defect was found. Existing tests and the focused regressions
added in #108 cover:

| Requirement                   | Evidence                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account/token isolation       | Scope mismatches yield no entry; replacement-token storage removes both cache keys.                                                                          |
| Sign-out and Full Reset       | Firefox runtime clears cache keys; background unit tests await pending app/cache writes before acknowledging cleanup.                                        |
| Aborted/invalidated writes    | Tests reject writes after abort and after generation invalidation during encryption, before storage commit.                                                  |
| Corruption and malformed data | Corrupt ciphertext, unsupported schema and malformed decrypted identity cannot supply a validator or make a bare 304 succeed.                                |
| Expired cache or absent ETag  | Expiry causes unconditional 200 fetching; a 200 without an ETag removes the prior entry.                                                                     |
| Cache failures                | Storage-read and key-derivation failures permit ordinary fetching. Quota failure is isolated from complete snapshot, badge and update publication.           |
| Required-detail failure       | A 304 without valid matching data fails; existing Chrome E2E preserves both app/comparison snapshots and the prior cache after required failure.             |
| Cooldown handling             | Cached-detail 403 rate-limit regression retains failure/cooldown metadata; the full existing cooldown suite also passes.                                     |
| Fresh independent status      | Review dismissal and same-SHA CI changes are detected despite 304. Changed 200 details update draft→ready, ready→draft and reviewer assignments.             |
| Bounds                        | Existing tests exercise 24-hour expiry, 100-entry eviction, 64 KiB single-body and 1 MiB aggregate bounds; oversized data do not invalidate the live result. |

## Recommendation and remaining risks

**KEEP**, restricted to canonical detail. The authenticated sample demonstrates
the intended primary-quota/body benefit, and deterministic browser tests support
the lifecycle and correctness boundaries. The measured local cost is modest
for the 40-PR fixture, but the cache is not a demonstrated speed optimisation.
No additional endpoint caching, key-derivation changes or limit changes are
justified by this sample.

Persistence has a concrete advantage over memory-only storage: an eligible
entry remains useful in the first refresh after actual MV3 worker termination.
We have not measured how often normal workers stop between polls, so the size
of that advantage in daily use remains unknown. The current age/size limits
are reasonable conservative pilot bounds, not tuned workload estimates. At
150 active PRs, the 100-entry limit alone caps simultaneous eligibility at
two-thirds before expiry, representation changes or missing ETags; we did not
measure a real 150-PR account. Frequently revalidated 304 entries still expire
24 hours after the last stored 200.

Remaining work is an active/private-repository longitudinal sample, authenticated
end-to-end browser refresh timing and compressed transfer measurements, native
Chrome post-restart and Firefox network 304 journeys, and slower-device/storage
profiles. These gaps limit general claims, not the observed selected-sample
savings. If routine hit rates are low or maintenance failures grow, reconsider
the separate optional cache path rather than weakening freshness or encryption.

## Verification

Local compilation and Oxlint passed, along with 719 unit tests (711 before
changes), 61 headed and 61 headless Chrome E2E tests, both Firefox runtime tests,
and production Chrome/Firefox builds. Changed-file Prettier and the PR diff
whitespace check passed. Repository-wide formatting still reports 122 unrelated
files; they were left unchanged. E2E-generated screenshots are excluded from
this change. The GitHub `verify` job runs the application checks on Node 24;
its result is reported on the pull request.
