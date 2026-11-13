# Screenshots and store assets

These are draft assets for the next release. Nothing has been uploaded to either
store. The extension version remains unchanged at 1.0.23; the images show `main`
after PR #113 (`c593660d78e2b8e3446244142ede9d71ac79d6a9`).

## Capture the extension

Use Node.js 24 and the normal [development prerequisites](development.md).
The existing Puppeteer installation supplies Chrome. Firefox defaults to
`C:/Program Files/Mozilla Firefox/firefox.exe`; set `FIREFOX_PATH` elsewhere.
A visible desktop session is needed. No `.env.test`, personal token or GitHub
account is required.

Run from the repository root:

```sh
npm run build:e2e
npx vitest run --config vitest.e2e.config.ts tests/readme-screenshots.e2e.test.ts
npm run build:firefox
npx vitest run --config vitest.config.ts tests/firefox/store-screenshots.firefox.test.ts
node scripts/render-store-assets.mjs
```

The opt-in scripts load the actual packaged Chrome MV3 and Firefox MV2 popup
pages in browser tabs at 750 × 640 CSS pixels, with device scale factor 2.
Source PNGs are 1500 × 1280; README captures use the top 750 × 600 CSS pixels,
producing 1500 × 1200 images for sharper display at README sizes.
They capture extension content, without browser chrome. They do not capture the
native toolbar panel or claim to verify its sizing. No production styles or DOM
content are replaced to arrange the images.

The shared [fixture and scene driver](../tests/helpers/screenshotDemo.ts) uses
six fictional PRs across three `demo-workspace` repositories, local SVG initial
avatars and a fixed clock (`2026-11-13T12:00:00.000Z`). Demonstration identities
and GitHub URLs are illustrative, not links to real tracked work. The existing
encrypted E2E seed and mocked GitHub responses provide the data. The scripts
never read real credentials or request live GitHub PR data.

Both themes cover All PRs, mixed collapsed/expanded repositories, a search
matching a collapsed repository, and Advanced with only No CI selected. The
search scene excludes Failing and Pending CI; clearing search restores the saved
collapse choices. Settings is also captured in Chrome dark theme. Assertions
check visible cards, counts, title/repository tooltips, absence of horizontal
overflow and the final Pending background from PR #113 (`#c99d08`). That colour
retains PR #113's accepted white-text contrast exception; these assets do not
claim to resolve it.

README images live in [assets/readme](assets/readme/). Only two are displayed in
the README, with links to search, Advanced, dark All PRs and Settings examples.
Uncropped captures for each browser live under `assets/stores/<browser>/source/`.
These are genuine rendered UI screenshots, not generated mockups. The export
script only crops/resamples screenshots and reuses existing branding.

## Store exports

Each browser has its own four 1280 × 800 PNG exports. Upload in this order:

| File                       | Scene               | Crop from 1500 × 1280 source         | Suggested caption                                |
| -------------------------- | ------------------- | ------------------------------------ | ------------------------------------------------ |
| `01-all-prs-light.png`     | All PRs, light      | x 0, y 320, width 1500, height 937.5 | Review status, CI and reviewers in one list      |
| `02-repositories-dark.png` | By repository, dark | x 0, y 320, width 1500, height 937.5 | Expand the repositories you want to see          |
| `03-search-light.png`      | Search, light       | x 0, y 0, width 1500, height 937.5   | Find matching PRs, including in collapsed groups |
| `04-advanced-dark.png`     | Advanced, dark      | x 0, y 0, width 1500, height 937.5   | Filter No CI and Unknown separately              |

The first two focus on results; the others retain the header and filters. Crops
are scaled uniformly, edge to edge, without frames, added captions or padding.
They are feature close-ups, not a claim that a toolbar popup is 1280 × 800.

- [Chrome assets](assets/stores/chrome/) include an optional 1400 × 560 marquee,
  resized from the unchanged watchtower hero. Use the existing
  [128 px package icon](../public/icons/icon-128.png). No new small promotional tile is
  proposed; it is optional.
- [Firefox assets](assets/stores/firefox/) include a 64 × 64 icon resized from
  the same existing icon. Screenshots come from Firefox, not Chrome.
- The original hero, watchtower logo, popup branding and package icons remain
  unchanged. The marquee is promotional artwork, separate from UI screenshots.

Captures were made on Windows 11 (10.0.26300) with Node.js 24.20.0,
Chrome 156.0.8078.47 and Firefox 160.0. Each browser's source directory contains
`capture.json` recording these details and the viewport. Versions are recorded when regenerating;
font rasterisation can differ across platforms. Fixed data and clock make the
scenes repeatable; PNG byte equality across browser versions is not promised.

## Listing review and submission requirements

Reviewed the public [Chrome listing](https://chromewebstore.google.com/detail/pr-tracker/kfeglmkcicfmegclihokchplngcokgil)
and [Firefox listing](https://addons.mozilla.org/en-US/firefox/addon/pr-tracker/)
on 13 November 2026, including their existing screenshots. They show the older
interface and omit the new View selector and grouping controls. Their short
summaries are still “Track and manage your GitHub pull requests”; the detailed
copy does not explain grouping or Advanced CI filters.

Current official requirements checked for these exports:

- Chrome accepts one to five screenshots at 1280 × 800 or 640 × 400, with square
  corners and no padding. Its optional promotional sizes are 440 × 280 and
  1400 × 560. See [Chrome image requirements](https://developer.chrome.com/docs/webstore/images)
  and [listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).
- Firefox recommends 1280 × 800 screenshots, or a 1.6:1 ratio, and supports
  separate captions. It recommends 32 or 64 px icons and limits the summary to
  250 characters. See [Mozilla's listing guide](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/).

Prepared copy and manual submission notes are in
[CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) and
[the Firefox listing draft](store-listings/firefox.md). Check the dashboard's
current validation again at upload time. Do not upload screenshots advertising
features before the corresponding release is available.

## Review before uploading

1. Regenerate both browsers and inspect all four exports at full size and at
   640 × 400. Confirm text, counts, collapse indicators and open Advanced menu.
2. Check image dimensions, relative README links and unchanged branding. Run
   changed-file Prettier and `git diff --check`.
3. Review the proposed copy against the release, existing permissions and privacy
   policy. Firefox's public API currently reports Apache 2.0 while this repository
   has an MIT licence; confirm the intended listing licence before correcting it.
4. Upload the matching browser's screenshots and copy manually as part of an
   authorised store submission. This PR does not submit a package or edit listings.
