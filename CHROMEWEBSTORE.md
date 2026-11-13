# Chrome Web Store listing draft

Prepared 13 November 2026 for the next release. This is proposed copy and asset
selection, not a live listing change or release checklist.

Name: **PR Tracker**. Keep the current publisher, support links, language and
Tools category unless the publisher decides otherwise.

The current manifest description is “Track and manage your GitHub pull requests”.
Chrome takes the short description from the manifest; this PR leaves it unchanged.
A possible replacement for a separately authorised release change is:

> Track GitHub pull requests, group by repository, and filter reviews and CI status from your browser toolbar.

It fits Chrome's [132-character description limit](https://developer.chrome.com/docs/extensions/reference/manifest/description).

## Proposed detailed description

PR Tracker brings your GitHub pull requests and review requests into your browser
toolbar. Check review and CI status, see reviewers and PR age, and open a pull
request directly on GitHub.

Choose All PRs for a single detailed list, or By repository for collapsible
repository groups. See matching PR and repository counts, expand individual
groups or use Expand all and Collapse all. Your view and collapse choices are
remembered when you close the popup and return later.

Search PR titles and repository names. Matching repositories open temporarily
during search; clearing search restores your saved collapse choices. Hover over
a title or repository name to read its full text.

Filter by draft or ready state, age and review status. Select Passing, Failing
and Pending CI directly, or open Advanced for No CI and Unknown. Include PRs you
previously reviewed, sort your list, hide individual PRs, or save a custom GitHub
search query.

Choose a light, dark or system theme. Refresh manually, see when GitHub was last
successfully checked, and optionally receive desktop notifications for newly
discovered tracked PRs. Background checks run about every five minutes while
an unlocked session is available, subject to browser scheduling and GitHub limits.

Connect a GitHub personal access token and choose a password. Your token and
cached account data are encrypted in local extension storage. PR Tracker sends
authenticated requests directly to GitHub and has no separate backend. Author
and reviewer avatars may load from remote image URLs. An optional remembered
session lasts up to 12 hours and ends on browser restart.

## Assets and listing fields

- Screenshots: [Chrome exports](docs/assets/stores/chrome/), files
  `01-all-prs-light.png` through `04-advanced-dark.png`, in that order. Each is
  1280 × 800 PNG; use all four.
- Store icon: existing [128 px package icon](public/icons/icon-128.png).
- Optional marquee: [1400 × 560 PNG](docs/assets/stores/chrome/marquee-1400x560.png),
  derived from the existing hero. A small promotional tile is optional and is
  not included in this refresh.
- Homepage/support: [repository](https://github.com/aabiskar1/pr-tracker) and
  [issues](https://github.com/aabiskar1/pr-tracker/issues).
- Privacy policy: [existing published policy](https://aabiskar1.github.io/pr-tracker/privacy.html).
- Distribution, publisher contact and existing privacy disclosures: retain the
  current dashboard settings; review their accuracy before submission.

The single purpose remains tracking GitHub pull requests from the browser toolbar.
Permissions are unchanged: storage holds encrypted account data and preferences;
notifications report newly discovered tracked PRs; alarms schedule refreshes
and remembered-session expiry; `https://api.github.com/*` enables authenticated
GitHub PR, review and CI requests. No additional permissions are requested.

When the corresponding release is ready, manually replace the old screenshots,
review the detailed description and check its preview at normal listing size.
Verify the current [image requirements](https://developer.chrome.com/docs/webstore/images)
and [listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
before uploading. Keep the existing installation URL. This PR changes no live
listing, package version, release configuration or privacy policy.

Capture instructions and crop details: [docs/screenshots.md](docs/screenshots.md).
