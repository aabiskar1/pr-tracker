# PR Tracker 1.0.24

This release adds repository views to help you navigate longer pull request lists.

## Repository views

- Choose **All PRs** for the familiar list, or **By repository** for collapsible
  groups showing the full repository name and matching pull request count.
- Expand or collapse individual repositories, or use **Expand all** and
  **Collapse all**. Your view and collapse choices are remembered when you close
  the popup, unlock again or restart the browser. New repositories start expanded.
- Search pull request titles and repository names across your tracked list.
  Matching repositories open temporarily while searching; clearing the search
  restores your saved collapse choices.
- See matching pull request and repository counts, including matches inside
  collapsed groups. Existing filters and sorting still apply, and Reset Filters
  leaves your view and collapse choices alone.

## Interface improvements

- A compact **View** selector sits beside the result count below search, with
  repository expansion controls on a separate row.
- Repository headings have clearer boundaries, wrap long names and support
  keyboard expansion and collapse.
- Hover over a pull request title, repository badge or repository heading to
  read its full text. Full repository identities are shown where available.
- Review and CI badges and their active filters use more consistent colours,
  with improved contrast for green, red and neutral status text. Pending retains
  white text on yellow, which still has limited text contrast.

## Existing data and documentation

- Existing account data, filters and settings are retained. All PRs remains the
  default until you choose repository grouping. Groups reuse the detailed cards,
  including reviewers, CI and review status, author, age and hide controls.
- Refreshed the README and documentation screenshots for the current interface.
- Prepared five new promotional screenshots and a Chrome Web Store marquee.
  These are store-listing assets; live listing updates are published separately
  from the extension package.
