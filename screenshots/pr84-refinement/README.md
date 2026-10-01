# PR #84 visual comparison

Compare the same packaged popup fixtures on main (`871cb50`), the previous PR #84 head (`0acd110`), and this refinement. All captures use Chrome headless, device scale 1, reduced motion, fixed popup time (`2026-10-01T12:00:00Z`), and `POPULATED_PRS` restored after startup refresh so all six badge states are present. Main was built in an isolated archive with the existing dependencies.

Normal captures use 750 x 600; wrapping captures use 640 x 600. The wrapping fixture repeats a sentence four times on the first PR and an unbroken string thirty times on the dashboard-components PR. PNGs capture the full page; accompanying JSON records computed title and badge styles.

| Fixture         | Main                          | Before                            | After                           |
| --------------- | ----------------------------- | --------------------------------- | ------------------------------- |
| Light, normal   | [Main](main-light-normal.png) | [Before](before-light-normal.png) | [After](after-light-normal.png) |
| Dark, normal    | [Main](main-dark-normal.png)  | [Before](before-dark-normal.png)  | [After](after-dark-normal.png)  |
| Light, wrapping | [Main](main-light-long.png)   | [Before](before-light-long.png)   | [After](after-light-long.png)   |
| Dark, wrapping  | [Main](main-dark-long.png)    | [Before](before-dark-long.png)    | [After](after-dark-long.png)    |

Interaction captures: [light hover](after-light-hover.png), [dark hover](after-dark-hover.png), [light keyboard focus](after-light-focus.png), and [dark keyboard focus](after-dark-focus.png).

The previous 14px/600 titles overemphasised long text. The refinement uses 13px/500 with 19.5px line height and restores the original heading colour. Regular-weight badge labels, a familiar green, softer red, and less saturated yellow preserve the solid status identity. Text contrast is 4.63:1 for passing/approved, 5.24:1 for failing/changes, and 7.30:1 for pending in both themes.

Card structure, neutral rail, coloured age, reviewer/author arrangement, wrapping fixes, contextual status labels, hover underline, and keyboard focus remain. Filters, sorting, API behaviour, popup dimensions, permissions, and dependencies are unchanged.

Validation: compile, lint, 296 unit tests, 35 headless Chrome E2E tests, Chrome and Firefox builds, changed-file Prettier checks, and `git diff --check` passed. The repository-wide formatting check still flags existing untouched files and unrelated untracked local artifacts. Firefox is build-verified; the existing runtime harness is Chrome-only.
