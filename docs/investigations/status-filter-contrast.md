# Status and filter text contrast

Follow-up to the [PR #112 investigation](grouping-performance-usability.md#accessibility).
Checked on 13 November 2026 against `main` at `4643cd6` and this fix.

Pending uses bright yellow `#c99d08` with white `#ffffff` text, icons and separators
in cards and active filters. It is slightly darker than the original `#dbab09`.
Following visual review, the user explicitly accepted lower Pending contrast to
keep this brighter appearance with white content. Its **2.53:1 text contrast does
not meet 4.5:1**, and its icons also fall below 3:1. Active Passing and Approved
filters use the existing card green `#238636`. Their text is white in both themes,
as is active red filter text. Card green/red, draft and neutral palettes are
unchanged. Status names, icons, sizes, layout and filter behaviour are unchanged.

The hidden review/CI filter checkboxes now give their adjacent visible badges
a two-pixel focus outline using the existing ring token. This makes the focused
filter apparent without moving or resizing it.

## Measurements

Ratios use WCAG sRGB relative luminance. The targets remain **4.5:1 for text** and
3:1 for icons/focus indicators, with Pending explicitly excepted as described
above. Values below are rounded; assertions use the
unrounded ratio. Before values come from PR #112 and the unchanged `main` colour
pairs. After values were read from computed styles in actual toolbar popups in
Chrome for Testing **156.0.8078.47 MV3** and Firefox **160.0 MV2**, on Windows 11.
Both browsers returned the same values in each theme.

| Text                         | Before light/dark | After light/dark |
| ---------------------------- | ----------------: | ---------------: |
| Pending card badge           |       2.13 / 2.13 |      2.53 / 2.53 |
| Active Pending filter        |       2.13 / 1.81 |      2.53 / 2.53 |
| Active Passing/Approved      |       3.13 / 2.65 |      4.63 / 4.63 |
| Active Failing/Changes       |       5.47 / 4.63 |      5.47 / 5.47 |
| Passing/Approved card        |       4.63 / 4.63 |      4.63 / 4.63 |
| Failing/Changes card         |       5.24 / 5.24 |      5.24 / 5.24 |
| Draft card badge             |       7.00 / 7.00 |      7.00 / 7.00 |
| Unknown card badge           |     14.84 / 13.98 |    14.84 / 13.98 |
| No CI/Unknown advanced label |     15.80 / 15.89 |    15.80 / 15.89 |

No CI intentionally has no card badge. Advanced choices retain ordinary text
and native checkboxes. Active Drafts/Ready/Reviewed checkmarks remain 6.29:1
in light and 4.63:1 in dark. Deselected Pending chips also pass the text threshold.
Faded card icons are measured after compositing their existing 80% opacity.
Pending icons measure 2.13–2.53:1 and are part of the approved exception; other
status icons still meet 3:1. Focus outlines exceed 3:1 against the filter surface.

## Reproduction and coverage

Use Node 24 and the existing dependencies:

```sh
npm run test:unit
npm run build:e2e
npx vitest run --config vitest.e2e.config.ts tests/e2e/status-contrast.e2e.test.ts
npm run build:firefox
npx vitest run --config vitest.config.ts tests/firefox/status-contrast.firefox.test.ts
```

The unit matrix reads the real theme tokens, resolves inheritance and aliases,
and covers every shared status variant plus production card/filter pairs.
Pending tests assert the exact chosen colours, white content and measured ratio;
they record the exception instead of claiming it passes the contrast targets.
The 4.5:1 text and 3:1 icon checks remain for all other measured states.
Browser fixtures include Passing, Failing, Pending, Approved, Changes, Draft,
Unknown and No CI. GitHub responses are deterministic mocks; authentication,
encrypted fixtures, CSS and components use the existing extension harness.
Chrome opens `chrome.action.openPopup()`; Firefox opens the extension through
its toolbar menu. No tab viewport stands in for a toolbar measurement.

Both browser tests measure active states, advanced choices, focus and deselection.
Chrome uses keyboard Tab/Shift+Tab/Space and pointer hover. Firefox uses its
privileged frame for focus/click checks and the inspector's CSS hover lock;
this verifies hover styling, not physical mouse or trusted keyboard input.
Screenshots of the top, scrolled cards and focused filter are written with
computed-colour JSON to the OS temporary directory as `pr-contrast-{browser}-*`.
Visual review of both native popups in both themes confirmed the intended
yellow/green/red meanings and no new wrapping or clipping.
The four tracked CI-status/Advanced screenshots are refreshed for the new colours.

Modern Web Guidance's colour and accessibility guides informed the contrast
thresholds and `:focus-visible` outline. Fixed, tested token pairs work in both
browsers without a dynamic colour API, library or permission change.

This is a focused status/filter change, not a complete accessibility audit.
Pending remains below the contrast targets by the user's explicit choice.
It does not establish screen-reader, high-zoom or forced-colours conformance;
the remaining limitations in PR #112 still apply. Other popup text, including
age indicators and search placeholders, is outside this colour change.

## Verification

Node 24 compilation, Oxlint, 812 unit tests, 29 relevant headed Chrome E2E tests
and six Firefox runtime tests passed. Eleven focused headless Chrome checks also
passed. The Firefox run includes grouping persistence, Advanced CI and
detail-cache regressions.
Both production builds, changed-file Prettier and `git diff --check` passed.
Required GitHub CI also runs the complete headless Chrome suite; its results are
recorded on the pull request.
