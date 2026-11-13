# Repository grouping: performance and usability

Investigation for PR #112, reviewed on 13 November 2026 against `main` at
`045386cbbac8a820a18f2d84b81d9a389e6b6728`, including merged PR #111.
No production code, dependencies, permissions, versions or release configuration
are changed. The earlier [design investigation](pr-grouping-design.md),
[architecture](../architecture.md#repository-grouping-in-the-popup) and
[single-sample measurements](../testing.md#large-list-measurements) remain useful
context, not representative benchmarks.

## Executive findings

Grouping is usable at 100–200 PRs on this reference desktop, particularly with
collapsed repositories and specific searches. No performance release blocker was
demonstrated. Bulk expansion and broad searches can still cause noticeable pauses:
Chrome's 200/30 expansion median was 156 ms, ranging from 127–248 ms; a broad
search reopening all matches had a 223 ms median. Firefox was generally quicker
in this run. These results do not establish performance on slower laptops.

One **release-blocking accessibility fix is recommended before v1.0.24**:
existing pending-status and some filter-label colour pairs have insufficient
text contrast. This predates grouping and was confirmed in the unchanged
production popup. Fix it separately; do not turn this investigation into a UI PR.
High zoom and real screen-reader use remain unverified.

## Environment and method

Windows 11 Pro build 26300, Intel Core Ultra 7 265K (20 cores/logical processors),
approximately 63.5 GiB OS-visible RAM, RTX 5070 driving a 2560×1440 display at
239 Hz. Node 24.20.0, Chrome for Testing 156.0.8078.47 MV3 and Firefox 160.0 MV2;
headed, unthrottled, serial browser runs. This is one powerful machine, one OS
and one session per series. No browser ranking or low-end-device guarantee follows.
Other desktop applications remained open; CPU/GPU resources were not isolated.
Unit checks briefly overlapped the experimental containment series. Treat its
comparison as exploratory and repeat it on an idle machine before implementation.

The [isolated runner and instructions](grouping-benchmark/README.md) reuse the
current Dashboard, filtering hook, grouping helpers, detailed cards and production
CSS in **actual toolbar panels** copied to temporary extension builds. Only the
copy's popup entry and persistence boundary are replaced. Plain deterministic
fixtures and in-memory operations exclude GitHub fetching, encryption, persistent
storage and real IPC from the timing. Authentication/unlocking, bundle loading
and complete popup-opening latency are not measured.

Two warm-ups are discarded before seven trials per operation/scenario. Initial
render means mounting the data-ready UI from a prepared fixture. Interaction
timings use the content process's clock, ending after expected results and two
animation-frame callbacks. They include UI hydration/reconciliation and a paint
opportunity, not physical presentation, input queueing or INP. CPU/React profiles
are separate evidence. [Raw measured samples](grouping-benchmark/samples.csv)
include all trials; the runner exports machine-readable summaries to the OS temp
directory. No timing assertion is added to CI.

## Reproducible scenarios and results

Each fixture cycles the existing four detailed-card variants: draft/ready,
review/CI states, authors and zero/one/two/twelve reviewers, with embedded avatars.
Normal titles are about 130 characters. The six distributions below retain every
PR. Within-group order comes from the existing filter/sort/search pipeline.

All timings below are **median (minimum–maximum), milliseconds**. There are seven
observations per cell, except typing: six settled, broad-match prefixes per trial
give 42 individual keystrokes. Trials reset to the same preconditions; this does
not model overlapping rapid input or saturated CPU. Ranges are observed sample
variability, not confidence intervals or percentile estimates.

### Mounting and disclosures

Initial = data-ready All PRs mount; View = switch to By repository. Expand and
Collapse affect every matching group. Individual opens the first collapsed group:
5–7 PRs in distributed cases, all 100/200 in single-repository cases.

| Browser | PRs/repos |             Initial |                View |              Expand |         Collapse |          Individual |
| ------- | --------- | ------------------: | ------------------: | ------------------: | ---------------: | ------------------: |
| Chrome  | 10/2      |    25.1 (17.9–32.5) |    14.8 (13.9–19.2) |    16.8 (12.9–18.7) |    5.9 (5.3–7.2) |        9.5 (9.1–14) |
| Chrome  | 40/8      |    34.9 (33.5–65.2) |    38.2 (32.7–72.1) |    46.3 (31.3–71.4) |     8.5 (7–11.2) |     13.9 (9.5–19.2) |
| Chrome  | 100/20    |       90.5 (70–131) |   82.5 (71.4–103.3) |   99.7 (68.4–133.7) |    12 (9.7–14.1) |      12.7 (10.9–23) |
| Chrome  | 200/30    | 181.6 (123.5–260.7) | 158.4 (149.4–191.2) | 156.3 (127.1–247.5) | 16.9 (16.6–23.4) |    19.8 (14.7–24.2) |
| Chrome  | 100/1     |   98.3 (63.5–131.9) |    71.2 (66.5–97.8) |    64.7 (61.2–94.3) |   9.2 (7.8–12.1) |    66.8 (62.3–95.8) |
| Chrome  | 200/1     | 167.2 (119.9–233.5) |   151.7 (144.1–191) | 129.8 (121.8–189.7) | 13.4 (12.7–19.3) | 161.3 (121.1–186.6) |
| Firefox | 10/2      |          12 (11–14) |          14 (13–16) |          11 (11–12) |          7 (6–8) |            7 (7–12) |
| Firefox | 40/8      |          20 (19–21) |          29 (27–32) |          24 (23–34) |         9 (7–10) |             7 (6–9) |
| Firefox | 100/20    |          39 (38–44) |          64 (62–73) |          55 (53–64) |       13 (12–14) |            8 (7–10) |
| Firefox | 200/30    |          74 (70–77) |       129 (125–182) |       118 (114–139) |       20 (17–23) |           11 (8–25) |
| Firefox | 100/1     |          40 (38–42) |          61 (56–69) |          51 (48–57) |       19 (11–68) |          51 (49–57) |
| Firefox | 200/1     |          76 (71–79) |       134 (127–144) |       104 (100–110) |       19 (15–37) |       119 (110–159) |

### Search and repeated input

One match searches for a unique title in collapsed groups; Broad searches for
`repository`, opening every match. Clear restores all saved collapsed choices
after the one-match search. Typing starts expanded, with every prefix matching
all PRs. Filter repeatedly turns Drafts off from the initial state; half the
larger fixtures remain. These are independent filter trials, not a burst test.

| Browser | PRs/repos |      One match |               Broad |          Clear |           Per key |           Filter |
| ------- | --------- | -------------: | ------------------: | -------------: | ----------------: | ---------------: |
| Chrome  | 10/2      |    6.5 (5.9–8) |    16.9 (11.9–19.2) |    7.4 (5–9.5) |   11.7 (8.8–15.1) |   8.8 (7.6–11.2) |
| Chrome  | 40/8      | 6.3 (5.6–13.7) |    45.7 (28.5–67.8) | 7.1 (5.4–12.7) |  22.3 (19.1–37.8) |   19 (15.1–23.7) |
| Chrome  | 100/20    |  5.8 (5.4–6.5) |     66 (64.5–123.9) | 8.4 (7.8–10.7) |  42.8 (39.6–59.1) | 35.6 (29.2–43.5) |
| Chrome  | 200/30    |  6.1 (5.8–7.2) | 222.9 (123.7–245.5) | 8.5 (7.8–18.1) | 82.5 (72.6–113.1) | 64.8 (56.7–77.2) |
| Chrome  | 100/1     |  6.8 (5.7–8.2) |      63.3 (59–93.9) |  7.4 (7.2–7.7) |  41.3 (37.2–54.1) |   32.4 (29.4–43) |
| Chrome  | 200/1     |    6.1 (5.2–8) | 142.1 (114.1–176.8) |    7.4 (5–7.8) | 78.6 (70.5–108.5) |   57.4 (51–79.6) |
| Firefox | 10/2      |        7 (6–8) |            8 (7–11) |        7 (6–7) |           7 (5–8) |          7 (6–8) |
| Firefox | 40/8      |       7 (6–11) |          20 (19–24) |        7 (6–8) |          6 (4–11) |       11 (10–17) |
| Firefox | 100/20    |        7 (6–8) |          41 (39–46) |        7 (6–8) |          9 (7–22) |       22 (22–31) |
| Firefox | 200/30    |        7 (5–8) |          76 (73–89) |        7 (5–8) |        15 (11–66) |       42 (39–46) |
| Firefox | 100/1     |        7 (6–8) |          36 (34–42) |        7 (7–8) |          7 (6–20) |       23 (20–28) |
| Firefox | 200/1     |      12 (6–19) |          73 (65–80) |        7 (2–8) |        15 (10–46) |       42 (35–43) |

The previous 352 ms and 219 ms expansion samples included different orchestration,
launch flags, fixtures and sampling conditions. The new figures are **not** a
before/after speedup. The existing E2E measurement was also rerun: its single
200/30 expansion-to-second-frame sample was 356 ms, reinforcing that distinction.

## Where the time goes

Chrome's normal 200/30 expansion counter medians were approximately 39 ms script,
53 ms style recalculation and 42 ms layout. Broad-match typing averaged 14 ms
script, 40 ms style and 26 ms layout per keystroke across each six-key trial.
Counters surround the automation call and may include trailing work/result
collection; they are attribution clues, not an additive decomposition of the
in-page latency. A separate expansion trace recorded 3.4 ms renderer Paint,
46.6 ms Layout and 80.4 ms UpdateLayoutTree. It does not measure GPU presentation.

Separate production React profiling builds recorded median render durations of
42/40 ms for Chrome expansion at 200/30 and 200/1, versus 64/62 ms in Firefox.
Typing render medians were about 11 ms in Chrome and 9–10 ms in Firefox. Profiling
adds overhead, so these values must not be subtracted from normal timings.
Firefox has no equivalent Chrome Performance-domain/LoAF breakdown here. React
rendering alone does not explain Chrome's larger style/layout cost.

An isolated CSS experiment applied `content-visibility: auto` and a provisional
`contain-intrinsic-size: auto 9rem` to cards. No production stylesheet changed.

| Browser | PRs/repos |     Expand baseline | Expand experiment |  Per key baseline | Per key experiment |
| ------- | --------- | ------------------: | ----------------: | ----------------: | -----------------: |
| Chrome  | 200/30    | 156.3 (127.1–247.5) | 72.6 (59.8–127.7) | 82.5 (72.6–113.1) |   24.3 (18.9–34.4) |
| Chrome  | 200/1     | 129.8 (121.8–189.7) |  65.4 (55.5–87.2) | 78.6 (70.5–108.5) |   22.1 (16.5–38.1) |
| Firefox | 200/30    |       118 (114–139) |     113 (112–123) |        15 (11–66) |         15 (11–62) |
| Firefox | 200/1     |       104 (100–110) |     109 (101–130) |        15 (10–46) |         14 (10–42) |

This supports investigating containment for Chrome, not shipping it immediately.
Firefox showed little benefit and some slower operations. The DOM remains
mounted; variable card heights can change scroll extent as offscreen content is
revealed. Focus, find-in-page, screen-reader exposure and scroll anchoring need
dedicated checks before adoption. The experiment does not validate its height
estimate or demonstrate a need for virtualisation.

## Usability and browser differences

At 200/30, the grouped subtree contains **8,350 elements expanded and 240
collapsed**, consistently in both engines. At 100/1 it is 4,035 versus 8; at
200/1, 8,060 versus 8. Text nodes are additional. Collapsed cards are unmounted.
The detailed cards remain manageable through collapse/search; grouping offers
little scrolling benefit when one repository is fully expanded.

Normal native viewports were 756×600 CSS pixels in Chrome and 750×600 in Firefox.
No horizontal clipping was found in repository headings, titles or the results
row, including maximum-length identities in both themes. Firefox headings were
taller (42px versus 34px for a one-line heading). The 200/30 document measured
about 30,481/30,662px high in Chrome/Firefox, shrinking to 1,712/1,890px collapsed;
200/1 was about 28,580px. Programmatic document scrolling reached the bottom in
the native panels. A separate trusted CDP wheel/viewport-shortcut probe timed out;
the Windows computer-use fallback listed the test window but refused to bind to
it with an owner-mismatch error. Physical wheel usability, viewport shortcuts and
smooth scrolling therefore remain unverified, rather than being reported as an
extension defect or a passing manual check.

The controls scroll away with the list. Expanded 200/30 has 453 native tab stops
versus 53 collapsed. Reaching the next repository through a large expanded group
requires traversing its PR links and hide buttons. This is a real navigation
cost, not a defect in disclosure activation. Collapse all and search are the
existing quicker routes; no compact-card or sticky-toolbar redesign is justified
by these measurements alone.

Search exposed collapsed matches, kept counts accurate and restored saved choices
on clear. The search field retained focus. Production Chrome journeys passed
view switching, filtering/hiding focus recovery, encrypted persistence, popup
reopen, browser restart/unlock and Reset Filters independence. Production Firefox
passed native-panel reopen, collapse persistence and temporary search restoration.
Firefox browser restart was not covered. Expanding/collapsing changes document
height by design; no unintended horizontal shift or concealed focus target was
found in the sampled normal-size journeys. Scroll FPS and live activity reordering
were not measured.

## Accessibility

- Grouped headings form h1 → h2 → h3. Native disclosure buttons expose the full
  identity, total count, `aria-expanded` and valid panel references. Chrome's
  accessibility tree confirms the button role/name/state; this is not a
  screen-reader test.
- Trusted Tab, Shift+Tab, Enter and Space worked in Chrome. Collapsed links left
  the tab order, and focus stayed on the disclosure or recovered to the View
  selector after the last matching group was removed. Firefox's runtime checks
  cover focus retention, visible outlines and native-button activation; a full
  trusted keyboard sequence in Firefox was not separately automated.
- Settled heading-name contrast was about 14.35:1 light / 13.98:1 dark; counts
  5.56:1 / 6.24:1. Focus outlines were solid, approximately 4.72:1 / 6.03:1 against
  the heading surface. Theme transitions were finished only for audit sampling,
  never during timing trials.
- Chrome forced-colour emulation and Firefox's profile-local forced-colour
  preference both activated the media query. Text, disclosure boundaries and
  solid focus outlines remained visible. This is not an OS High Contrast audit.
- Native title attributes contain the exact PR title/full identity. Titles and
  grouped identities are also visible text; flat cards expose full identity as
  an accessible link description, confirmed by the existing Chrome AX check.
  Native hover tooltips themselves do not provide a keyboard/touch disclosure.
  No extra tab stop or invented owner is introduced.
- **200%/400% zoom is not verified.** Chrome's native popup ignored Ctrl+Plus.
  Firefox privileged fullZoom changed DPR and panel sizing, but canvas captures
  contained blank regions and did not establish usable user-driven magnification
  or reflow. No pass is inferred from unchanged DOM bounds. Manual browser/OS
  scaling checks remain needed against [WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- No real screen reader was used. NVDA/JAWS/Narrator output, announcement timing
  and the practical usefulness of repository-heading navigation remain unverified.

### Confirmed contrast issue

The read-only production probe confirmed these pairs in the real Chrome popup;
the shared-component Firefox harness reports the same values:

| Text                                                 | Light contrast | Dark contrast |
| ---------------------------------------------------- | -------------: | ------------: |
| Pending card badge, white on `#dbab09`               |         2.13:1 |        2.13:1 |
| Active pending filter, theme foreground on `#dbab09` |         2.13:1 |        1.81:1 |
| Active green filter, theme foreground on `#28a745`   |         3.13:1 |        2.65:1 |

These are ordinary small labels, not large text or disabled controls. They fall
below the [4.5:1 text criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
`src/styles/tokens.css:69–75,144–150` and `src/theme.css:144–177,197–202` define the
relevant colours. Card passing green was approximately 4.63:1 and is not included
in this finding. Existing status text/icons help avoid colour-only meaning but
do not remedy low text contrast. This is inherited styling, not a PR #111 regression.

## Relevant guidance

Google Modern Web Guidance is installed; its actual instructions and temporary
search/retrieve runner were used for `identify-inp-causes` and `performance`,
alongside the previously read accessibility guidance. Separating script, style
and layout was useful; the containment experiment followed the advice to pair
content visibility with an intrinsic size. No analytics library, beacon, worker
refactor or new extension permission was added. The
[official guidance repository](https://github.com/GoogleChrome/modern-web-guidance)
is advisory here.

The Vercel skills are absent from the available local catalogue. Reviewed the
official [Web Design Guidelines instructions](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md),
their required fresh [interface rules](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md),
and [React Best Practices instructions](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md)
and relevant individual rules. No skill was installed.

| Guidance                                                                                                                                      | Relevant conclusion                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface rules: focus, long content and inexpensive controlled input                                                                         | Native focus/wrapping checks passed; broad input at 200 PRs merits follow-up. `src/hooks/usePullRequests.ts:459` derives a new filtered/sorted array on every search change.                                |
| Interface rules: virtualise lists above 50                                                                                                    | Do not adopt that threshold: conditional collapse already removes most DOM, and measured latency/variable-height accessibility trade-offs matter more than item count.                                      |
| [React memoisation](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/rerender-memo.md)                 | `src/components/PullRequestList.tsx:43` reconstructs all visible cards; stable card props/memoisation are candidates if scripting remains material. They will not by themselves remove browser layout work. |
| [Deferred values](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/rerender-use-deferred-value.md)     | Consider only after measuring rapid-input backlog. Preserve immediate input, accurate counts and clear stale-result semantics; settled synthetic trials do not prove this is needed.                        |
| [Content visibility](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/rendering-content-visibility.md) | Chrome experiment supports a focused investigation; Firefox results and variable-height/focus risks prevent a blanket recommendation to ship it.                                                            |

## Priorities for v1.0.24

| Priority        | Focused follow-up and acceptance criteria                                                                                                                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocking**    | Fix the inherited status/filter text contrast before v1.0.24. Preserve status meanings, text/icons and both themes; demonstrate at least 4.5:1 for active small labels in native Chrome/Firefox and update deliberate visual/contrast assertions. This investigation makes no such change.                                                   |
| **Recommended** | Trial card containment with realistic long/variable heights. Repeat the same benchmark on both engines and a slower laptop; demonstrate a repeatable Chrome improvement without Firefox regression, lost links, changing counts, clipped focus or objectionable scroll jumps. Keep a baseline and test native Find and assistive technology. |
| **Recommended** | Complete real screen-reader, trusted Firefox keyboard and user-driven 200%/400%/OS-scaling review. Every grouping/search/bulk control and full identity must remain reachable, readable and correctly announced. Record failures rather than treating AX/DOM checks as substitutes.                                                          |
| **Optional**    | Profile sort/search separation and stable card props if script time remains important after layout work. Add deferred search only for demonstrated input backlog, with explicit stale-result behaviour.                                                                                                                                      |
| **Optional**    | Compact cards, heading-jump UI or virtualisation after user feedback or slower-device evidence. Preserve details, variable heights, browser Find, heading semantics and focus. Thousands of elements alone are not a trigger.                                                                                                                |

Grouping itself can proceed towards v1.0.24 without pagination, virtualisation or
a new UI library. The recommendation to fix contrast is the only confirmed release
blocker from this review; the uncompleted accessibility checks are explicit limits
on that assessment, not evidence of passing them.

## Verification

Node 24 compilation, Oxlint, 772 unit tests and Chrome/Firefox production builds
passed. The 23 existing Chrome grouping/popup-state E2E tests and two production
investigation probes completed successfully; four existing Firefox runtime checks
passed. The probes record the contrast defect rather than asserting accessibility
conformance. Changed-file Prettier, documentation references and `git diff --check`
passed. Only this report, isolated investigation scripts
and fixture measurement data are committed. CI status is recorded on the PR.
