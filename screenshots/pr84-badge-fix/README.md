# PR #84 status badge regression fix

Main / PR #82 (`871cb50`), the previous PR #84 head (`6a62980`), and this fix were captured with identical Chrome headless fixtures in light and dark themes. Main was built in an isolated archive with the existing dependencies. Device scale is 1, reduced motion is enabled, and popup time is fixed at `2026-10-01T12:00:00Z`. The deterministic `POPULATED_PRS` fixture is restored after startup refresh so all six statuses are present.

| Fixture                     | Main / PR #82                 | Before                            | After                           |
| --------------------------- | ----------------------------- | --------------------------------- | ------------------------------- |
| Light, 750px                | [Main](main-light-normal.png) | [Before](before-light-normal.png) | [After](after-light-normal.png) |
| Dark, 750px                 | [Main](main-dark-normal.png)  | [Before](before-dark-normal.png)  | [After](after-dark-normal.png)  |
| Light, long titles at 640px | [Main](main-light-long.png)   | [Before](before-light-long.png)   | [After](after-light-long.png)   |
| Dark, long titles at 640px  | [Main](main-dark-long.png)    | [Before](before-dark-long.png)    | [After](after-dark-long.png)    |

The previous change gave pending labels and icons a dark foreground, which made their type and hourglass treatment look inconsistent with the other statuses and the original popup. The fix restores white text and `currentColor` icon fills for both CI and review badges. It explicitly preserves the original 12px regular-weight type, 16px line height, 12px icons, 4px internal gap, and original opacity treatment on the category icon. Card status icons now sit at the vertical centre instead of inheriting the global SVG upward offset. Other popup icons and filter badges are unchanged.

The amber fill is deeper than the original yellow because white text on the original yellow has only 2.13:1 contrast. The retained amber gives white labels at least 4.5:1, keeping the existing accessibility guard without introducing dark pending glyphs. Green and red colours are unchanged from the preceding refinement.

The JSON companions record actual badge size, weight, line height, foreground, fill, icon opacity, dimensions, and centre offset. Main and before both use 12px/400/16px type; before pending foreground is `rgb(36, 41, 47)`. After all card status text and icons use `rgb(255, 255, 255)` and icon centre offsets are zero.

Preserved: card structure, coloured age indicator, long-title wrapping, contextual labels, title hover underline, and keyboard focus. Filters, sorting, API behaviour, popup dimensions, permissions, and dependencies are unchanged.

Validation passed: compile, lint, 296 unit tests, 35 headless Chrome E2E tests, Chrome and Firefox production builds, changed-file Prettier, and `git diff --check`. E2E guards now check original badge typography, matching text/icon foregrounds and fills, 12px icon dimensions, and centring in both themes at both widths. Existing contrast, wrapping, labels, age, hover, and focus assertions remain. The full formatting check still flags 108 untouched files/local artifacts. Firefox is build-verified; the runtime harness is Chrome-only.
