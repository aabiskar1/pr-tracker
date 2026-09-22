# Popup redesign — design proposal

Status: review proposal, not approved for production migration. The prototype is a test-mode fixture on `design/popup-redesign-prototype`, based on `main` at `c948aa6` (PR #81 merged). Theme migration PR #82 was open when this branch was created; this branch neither includes nor changes it. Production implementation should be rebased against the merged theme work after review.

## Direction and principles

PR Tracker is a work queue, not a dashboard. The proposed identity uses a compact pull-request monogram, crisp system typography, a restrained blue navigation accent, charcoal/white neutral surfaces, and a small amount of semantic status colour. Search is immediately visible. Titles receive the strongest weight; repository, number, age, ownership, and status form progressively quieter layers. There are no coloured card rails, oversized summary panels, shadows, gradients, or decorative animation.

Compared with the current popup, the header becomes one line, the large always-visible filter panel becomes a disclosed secondary panel, and individually bordered PR cards become a single scrollable list with thin row separators. The proposed row preserves the information users rely on: title, repository, PR number, created-age display, CI, review, author, and reviewer context. Counts represent the underlying view, not the current search result; the result count sits above the list.

## Information architecture and dimensions

```text
┌──────────────────────────────────────────────────────────────────────┐
│ PR Tracker · YOUR WORK QUEUE                  synced · refresh · settings │ 52
├──────────────────────────────────────────────────────────────────────┤
│  search pull requests, repositories, people…                     /  │ 55
│  All 5        For review 3        Created by me 2       Filters     │ 52
├──────────────────────────────────────────────────────────────────────┤
│  All pull requests  5                         Sort: Newest first     │ 45
│  ─────────────────────────────────────────────────────────────────── │
│  ○ Fix intermittent failures in the checkout pipeline              │
│    acme / platform  #2481  2h ago     By maria · Review requested   │ 91+
│    ! Checks failing    │    ◌ Awaiting review                        │
│  ─────────────────────────────────────────────────────────────────── │
│  … scrollable rows …                                                  │
├──────────────────────────────────────────────────────────────────────┤
│  ● All changes synced                             Press / to search  │ 30
└──────────────────────────────────────────────────────────────────────┘
```

The prototype is 720 × 600 CSS pixels, within the current production PR-list range of 640–750 px wide with 600 px minimum height in both Chrome and Firefox. A 640 px compact trial should preserve the same architecture and wrap metadata before any horizontal overflow; 720 px is the recommended starting width, not a final mandate. A 750 px comfortable trial buys title space but adds little value beyond the existing upper bound. No user-facing density setting is proposed. The PR list alone scrolls; header, search, navigation and footer remain in place. When advanced filters are expanded, the list gets less height rather than the popup growing indefinitely.

Spacing: 22 px horizontal inset, 52 px header, 39 px search control, 52 px navigation, 45 px list heading, 30 px footer; rows target 91 px minimum and grow for long titles. The line-and-space rhythm uses 4/8/12/16/22 px increments. Corners are limited to 4–7 px on controls and the logo; PR rows are flat.

## Typography and colour

Use the existing semantic tokens from `src/styles/tokens.css`: `background`, `foreground`, `card`, `muted`, `muted-foreground`, `border`, `input`, `primary`, `ring`, and the distinct CI and review status families. System UI sans keeps packaging simple and preserves native readability. Suggested type hierarchy: title 13 px/650, section label 12 px/700, navigation 12 px/550, metadata and status 10.5–11 px, brand 14 px. Tight title tracking is intentional; metadata uses tabular numerals for counts, numbers, and ages.

Light mode uses a white popup and list surface with a slightly cool muted search/filter surface. Dark mode uses the existing charcoal background/card distinction. Do not invert light colours algorithmically. Status text/icons use the semantic status foregrounds; passing and approved should be legible but quieter than failing checks or changes requested. The prototype proposes no production token edits. During implementation, review whether `--muted-foreground` and `--border` need a small contrast adjustment after the theme migration; any change should be measured in both themes and made centrally, not in individual React components.

## PR row and status semantics

The leading neutral pull-request icon indicates entity type, not urgency. The title wraps naturally. Draft is the only persistent badge in the row; it is neutral and adjacent to the title. The second line contains repository, number, relative **created** age, and ownership (`By … · Review requested` or `By you · Reviewer …`). The third line shows independent CI and review indicators, each with icon and text. Failing CI and changes requested use semantic danger text; pending CI uses warning text; awaiting review, draft and unavailable remain neutral. Passing CI and approved review are green but never fill the whole row. Do not derive a combined priority from these states. Do not reinterpret PR age; production must continue to use the existing created timestamp until an explicitly approved change.

The production row may become an external GitHub link with one clear accessible name. Any hide/unhide or secondary action must be a sibling control, not a button nested inside an anchor. The mock prototype deliberately has no external links or hide action: it cannot mutate live data and is for visual/interaction review only. A production migration must retain hide/unhide and hidden-PR access.

## Navigation, filters, search and sorting

The three top views are All, For review, and Created by me. Their exact membership requires mapping to current data semantics; `requested_reviewers` and `author` exist in the model, but counts and identity should be derived from the signed-in user, not hard-coded. The prototype uses fixture counts. View changes preserve search and advanced filters; the result count reflects their intersection. A future implementation must verify that this navigation does not silently exclude PRs currently visible in the All view.

The Filters button reveals ready/draft state, age (all/today/week/older), CI (passing/failing/pending), review (approved/changes requested/pending), sort, and custom GitHub query. Hidden PR access also needs a discoverable place in this panel during production migration; it is deliberately not simulated here. Reset restores current default filters. Custom query must retain its current explicit save/reset semantics and distinguish remote query from local search. The prototype's Apply query stores only local mock state; it never fetches GitHub or persists anything. Sort labels must preserve the actual current meanings: `urgent` currently means “Most Reviewers”, not a derived urgency score, and `most-stale` keeps its existing ordering. Search filters current rows by title/repository and should preserve the existing behaviour in production; mock search additionally accepts author and number solely for demonstration and must not be treated as an approved behaviour change.

`/` focuses search only when not typing in an input, textarea, or select. Ctrl/Cmd+K also focuses it; Escape blurs. Search has an explicit label and clear action. No command-palette framework is proposed.

## Feedback and non-happy paths

Refresh uses the existing refresh request and last-updated semantics in production. The header shows a subdued sync state, not an invented success signal. A spinner may indicate active refresh; it stops under reduced-motion preference. Loading keeps the shell stable and shows row-shaped skeletons. An empty result explains that no PRs match and offers Reset filters. An actually empty account should use different copy from a filtered-empty list. Stale data should retain last-known rows and show a timestamped, accessible warning; errors should identify whether cached rows are still available and offer a retry. The prototype demonstrates loading and filtered/fixture empty; stale/error are specified for production but not mocked because their real wording depends on existing error states.

Settings is a secondary surface for appearance, notifications, account, and sign-out. The prototype shows a nonfunctional preview; production must preserve all current preferences and auth actions. No new storage keys or theme mechanism are proposed. Light, dark and automatic preferences must continue to resolve through the existing root `data-theme` mechanism.

## Accessibility and browser constraints

All visible controls need labels, 2 px high-contrast focus indicators, keyboard activation, disabled semantics, and text/icon alternatives to colour. Navigation should expose the current view; expanded filters expose `aria-expanded`/`aria-controls`; status iconography is decorative because the label is present. Use native selects/checkboxes until a custom control provides equivalent keyboard and screen-reader behaviour. Avoid motion other than brief hover/refresh feedback, and disable it under `prefers-reduced-motion`.

Chrome MV3 and Firefox MV2 must retain the current 640–750 px PR-list sizing and Firefox scrollbar/layout workarounds until runtime-verified replacements exist. Avoid horizontal scrolling and extension CSP exceptions. The prototype uses only React, Lucide, the existing UI primitives and CSS, with no permissions or dependencies. A Firefox production build is not Firefox runtime validation.

## Prototype and review decisions

The fixture is reachable only in WXT `test` mode: `popup.html?popup-prototype=1&theme=dark` or `theme=light`. Add `&filters=1`, `&state=loading`, or `&state=empty` to inspect variants. It uses representative, invented PRs and cannot modify production data. The screenshots under `screenshots/prototype/` are captured from the built extension in Chromium at 720 × 600. UI primitives are reused, but prototype-only CSS keeps it independent of the production migration.

Visual review captures: [dark](../screenshots/prototype/popup-dark.png), [light](../screenshots/prototype/popup-light.png), [expanded filters](../screenshots/prototype/popup-dark-filters.png), [640 px compact](../screenshots/prototype/popup-dark-compact.png), [loading](../screenshots/prototype/popup-dark-loading.png), and [empty](../screenshots/prototype/popup-dark-empty.png). These images are artifacts of the mock fixture, not screenshots of the production popup.

Before implementation, approve or adjust: (1) 720 px target width and row density, (2) whether title lines should be capped, (3) exact membership/name of the “For review” view, (4) where hide/unhide and hidden PRs live, (5) whether metadata should continue to show both author and reviewer at this density, and (6) stale/error copy. The next milestone is a separate production PR that maps these decisions to existing data and preference behaviour after PR #82 is resolved; this design branch must not be treated as that migration.
