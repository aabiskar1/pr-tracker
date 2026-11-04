# Encrypted canonical-detail ETag pilot

## Decision and scope

**KEEP as a reversible, detail-only pilot; do not expand it without authenticated
measurements.** The implementation changes no search, review, CI, filtering,
notification or encrypted application-snapshot semantics. Every discovered PR
still makes a canonical-detail HTTP request. The cache can save body bytes and
may save authenticated _primary_ rate-limit units on 304s, but cannot save HTTP
calls and has no demonstrated latency benefit. GitHub's [conditional-request
guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)
requires correct authorization for zero-primary-cost 304s; secondary limits
can still apply. No authenticated live benchmark was performed.

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

## Measurement and overhead

The per-refresh in-memory metrics count conditional requests, detail 200s and
304s, missing entries, evictions and decoded 200 body bytes, plus encrypted
payload length, cache load/decrypt and encrypt/write durations, completed
refresh duration and any observed `x-ratelimit-remaining` value. They are not
logged or sent to a server. To repeat the isolated mock measurement, run
`PR_TRACKER_CACHE_MEASURE=1 npx vitest run tests/unit/detail-cache.unit.test.ts`
(set the environment variable using the local shell's syntax). Its output
contains only aggregate counters and durations. No private URLs or tokens are
included.

One local **mocked** one-PR custom-search trial produced:

| Metric                            |    Cold | Warm, detail 304 |
| --------------------------------- | ------: | ---------------: |
| `fetchPullRequests` HTTP requests |       4 |                4 |
| Detail 200 / 304                  |   1 / 0 |            0 / 1 |
| Decoded detail-body bytes         |     422 |                0 |
| Encrypted cache base64 characters |   1,056 |            1,056 |
| Cache load/key derivation         | 18.4 ms |          19.0 ms |
| Cache encryption/write            |  0.3 ms |             0 ms |
| Full local mocked operation       | 22.0 ms |          20.9 ms |

These are one-off local Web Crypto timings with immediate mocked transport,
not real GitHub latency or reliable performance estimates. The full background
refresh adds one `/user` request: five calls in this custom-query one-PR case,
or seven with the usual three discovery searches. The packaged Chrome E2E
also saw a mocked warm `If-None-Match`/304 and confirmed review and CI calls
continue. Its 304 and `x-ratelimit-remaining` values are fixtures, **not**
authenticated GitHub primary-rate-limit evidence. The earlier unauthenticated
probe in PR #105 observed 304s consuming primary quota. No real primary-unit
or wire-byte savings are claimed here.

A volatile-memory-only cache would avoid the encrypted storage and roughly
19 ms mocked load/key-derivation cost, but it loses every hit after MV3 worker
termination. An encrypted cache restored after module recreation passed unit
tests; an actual forced Chrome worker restart was not automated in this PR.
The existing real Firefox MV2 toolbar-popup smoke test passes, but it does
not exercise a cache 304 or worker restart in Firefox. Builds alone do not
establish cache-path runtime compatibility.

## Risks and follow-up

The gain depends on a high real 304 rate, valid ETags, correctly authorized
requests and sufficiently long worker gaps to justify persistent storage.
PBKDF2, storage quotas and large detail bodies may erase or reverse any
latency benefit. A future controlled, read-only authenticated trial should
compare real rate headers, received bytes, hit rates and end-to-end refresh
times across cold, warm, changed, expired and worker-restarted sessions without
logging credentials or private content. If gains are small or failures grow,
remove the pilot cleanly by deleting its separate cache path and keys; the
application snapshot format is unchanged. Do not extend this cache to reviews
or CI merely because a detail 304 succeeds.
