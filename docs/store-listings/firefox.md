# Firefox Add-ons listing draft

Prepared 13 November 2026 for the next release. Keep the name **PR Tracker**,
existing publisher details, support links and listing URL. No live fields have
been changed.

Proposed summary, within Mozilla's 250-character limit:

> Track GitHub pull requests from your toolbar. Switch between All PRs and collapsible repository groups, search and filter reviews and CI status, and keep your view preferences between sessions.

## Proposed detailed description

PR Tracker brings your GitHub pull requests and review requests into your Firefox
toolbar. Check review and CI status, see authors, reviewers and PR age, and open
a pull request on GitHub.

Use All PRs for one detailed list, or By repository for collapsible repository
groups. See matching PR and repository counts. Expand individual repositories
or use Expand all and Collapse all; your choices are remembered when you return.

Search titles and repository names. Search temporarily opens matching groups,
then restores your saved collapse choices when cleared. Hover over PR titles
and repository names for the full text.

Filter drafts, ready PRs, age, review status and CI. Passing, Failing and Pending
are directly available; Advanced includes No CI and Unknown. Include PRs you
previously reviewed, sort your results, hide PRs or save a custom GitHub query.

Choose light, dark or system theme. Refresh manually and see the last successful
GitHub check. Optional desktop notifications report newly discovered tracked PRs.
Background checks run about every five minutes while an unlocked session is
available, subject to browser scheduling and GitHub limits.

Connect a GitHub personal access token and choose a password. Your token and
cached account data are encrypted in local extension storage. Requests go directly
to GitHub; PR Tracker has no separate backend. Author and reviewer avatars may
load from remote image URLs. The optional remembered session lasts up to 12 hours
and ends on browser restart.

## Assets and manual review

Use these Firefox captures in order, with captions entered separately:

| Screenshot                                                               | Caption                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| [All PRs, light](../assets/stores/firefox/01-all-prs-light.png)          | Review status, CI and reviewers in one list      |
| [By repository, dark](../assets/stores/firefox/02-repositories-dark.png) | Expand the repositories you want to see          |
| [Search, light](../assets/stores/firefox/03-search-light.png)            | Find matching PRs, including in collapsed groups |
| [Advanced, dark](../assets/stores/firefox/04-advanced-dark.png)          | Filter No CI and Unknown separately              |

All are 1280 × 800 PNG, following [Mozilla's listing guidance](https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/).
The [64 px icon](../assets/stores/firefox/icon-64.png) reuses the existing package
icon. No Chrome-only promotional tiles are needed for this proposal.

Keep the [current listing](https://addons.mozilla.org/en-US/firefox/addon/pr-tracker/),
[support link](https://github.com/aabiskar1/pr-tracker/issues) and
[published privacy policy](https://aabiskar1.github.io/pr-tracker/privacy.html).
Permissions and privacy disclosures have not changed.

The [public listing API](https://addons.mozilla.org/api/v5/addons/addon/pr-tracker/)
reports Apache License 2.0 for version 1.0.23, whereas the repository
[licence](../../LICENSE) is MIT. Confirm the intended listing licence and correct
the metadata separately during manual submission review. Do not change licensing
by inference from this draft.

Upload only when the corresponding release is available. Preview all screenshots
and captions, check current dashboard validation and review the final copy before
submitting. This PR does not upload a package, publish assets or change live
listing metadata. See [capture instructions](../screenshots.md) to regenerate.
