# PR Tracker 1.0.23

This release improves CI filtering and review-history handling, and adds
encrypted caching for pull request details.

- PRs with no checks or commit statuses now have no CI badge. An **Unknown**
  badge distinguishes unavailable or incomplete CI information from checks
  that are still pending. CI detection also handles paginated check results.
- Moved the optional **No CI** and **Unknown** filters into an **Advanced**
  menu. Passing, Failing and Pending remain visible in the main filter row.
- Fixed the Advanced menu closing unexpectedly when Firefox resizes the
  toolbar popup.
- Review status now includes later pages of review history, helping PRs with
  many reviews show the latest review decisions. Incomplete history remains
  Pending rather than showing a result from only part of the history.
- Added encrypted caching for PR details. When GitHub confirms that details
  are unchanged with a **304 Not Modified** response, they can be reused,
  saving response data and authenticated API quota. Review and CI information
  continues to refresh normally.
- Cached details are kept in encrypted local extension storage and remain
  available after browser restarts until they expire. Sign-out, token
  replacement and Full Reset clear the detail cache.
