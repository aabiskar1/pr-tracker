# Grouping investigation runner

One-off evidence for [the investigation](../grouping-performance-usability.md),
based on `main` at `045386c`. This is not extension code or a new CI benchmark.
It uses the existing Node 24, Vite, React and Puppeteer dependencies. No manifest,
project configuration, dependency or production source is changed.

From the repository root, with dependencies already available:

```powershell
npm exec -- wxt prepare
npm run build:all
node docs/investigations/grouping-benchmark/run.mjs chrome
node docs/investigations/grouping-benchmark/run.mjs firefox
node docs/investigations/grouping-benchmark/run.mjs chrome --broad-search
node docs/investigations/grouping-benchmark/run.mjs firefox --broad-search
node docs/investigations/grouping-benchmark/run.mjs chrome --profile
node docs/investigations/grouping-benchmark/run.mjs firefox --profile
node docs/investigations/grouping-benchmark/run.mjs chrome --content-visibility
node docs/investigations/grouping-benchmark/run.mjs firefox --content-visibility
node docs/investigations/grouping-benchmark/run.mjs chrome --audit-only
node docs/investigations/grouping-benchmark/run.mjs firefox --audit-only
npm run build:e2e
npm exec -- vitest run --config vitest.e2e.config.ts docs/investigations/grouping-benchmark/production.e2e.test.ts *> "$env:TEMP/grouping-investigation-chrome-tests.log"
node docs/investigations/grouping-benchmark/export-results.mjs
```

The example uses PowerShell redirection. The recorded run also included the
existing grouping and popup-state Chrome suites in the probe log. On Unix redirect
that command to `$TMPDIR/grouping-investigation-chrome-tests.log` or `/tmp` as
appropriate. Firefox defaults to
`C:/Program Files/Mozilla Firefox/firefox.exe`; set `FIREFOX_PATH` elsewhere.
Run browsers serially on an otherwise idle, visible desktop. The native panel
must remain open. `--smoke` is a shorter diagnostic run, rejected by the exporter.

`run.mjs` copies a production build to an OS temporary directory, retaining its
manifest, permissions, background entrypoint and assets. It replaces only the
copy's popup entry with a minified production-mode bundle of the current
Dashboard, grouping components, cards and `usePullRequests`. The existing CSS is
copied unchanged. `memory.ts` replaces secure-storage reads and browser messaging
for this bundle only. It uses the existing grouping preference transformation;
filters, sorting and search use the production hook. Authentication, GitHub,
encryption, persistent storage and real IPC are outside the timed boundary.
This measures data-ready UI work, not complete popup opening/unlocking.

Fixtures reuse the four existing detailed-card variants, including draft/ready,
review/CI states, authors, zero/one/two/twelve reviewers and embedded avatar images.
Titles, IDs, canonical repository identities and timestamps are fixed. Normal
titles are about 130 characters; the separate long-text audit uses 39-character
owners, 99-character repository names and much longer titles. The run date affects
the existing relative-age display; recorded samples were taken on 13 November 2026.

Each operation has two discarded warm-ups and seven recorded trials, with a fresh
in-memory UI mount before each trial. The content clock starts immediately before
the action, waits for the expected card count, then one further animation frame.
There are at least two frame callbacks after the action. This allows a paint
opportunity; it does not measure physical presentation or INP. Initial mount
starts after fixture creation and old-root unmounting. Automation transport is
outside the interval. In-memory hydration/reconciliation remains inside it.

Typing uses six successive, settled prefixes of `repository`, all matching every
PR. CSV `type-key` rows retain all 42 keystrokes per scenario; `type-average` rows
retain each trial's mean and averaged Chrome CPU counters. These are not a burst
input-delay test. Filtering turns Drafts off, repeated from the same initial state.
Individual expansion opens the first group, containing 5–7 PRs in distributed
cases and 100/200 in single-repository cases. Search tests both one exact title
match and a broad match opening all collapsed groups. Clear follows the one-match
search with every repository saved as collapsed.

Chrome's Performance-domain counter deltas approximate scripting, style and
layout around the call; they also include result collection and possible trailing
work. Initial CPU counters include setup and are deliberately excluded from the
export. A separate trace samples renderer Paint/Layout/UpdateLayoutTree events;
their durations overlap nested work and must not be added to React timings.
`--profile` uses React DOM's production profiling entry in a separate series.
Normal production React has no Profiler timing callbacks. Firefox has no Chrome
counter equivalent here, so its CPU breakdown is limited to the React profile.

`--content-visibility` adds a CSS rule **only in the temporary copy**:
`content-visibility: auto; contain-intrinsic-size: auto 9rem` on cards. The estimate
is provisional, based on the fixture's roughly 140px average card height. It is
not an implementation proposal with completed scroll/accessibility validation.
Native zoom experiments are attempts, not passing zoom/reflow tests: DPR changes
and privileged canvas captures do not establish usable 200%/400% browser zoom.

Raw JSON, traces and screenshots stay in the OS temp directory. `GROUPING_RESULTS`
overrides the JSON filename; the exporter expects the default filenames. It
exports [samples.csv](samples.csv) and a temporary `grouping-summary.json`, removing
local temporary paths. The CSV includes measured observations only. No data comes from
an account or live GitHub request. Temporary copied builds are retained for review;
the runner closes its browser and does not recursively delete directories.
