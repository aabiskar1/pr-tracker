# PR Tracker 1.0.21

This maintenance release includes the popup polish and reliability improvements
merged since 1.0.20.

- Added Watchtower branding beside the PR Tracker popup title while preserving
  the original blue PR browser toolbar icons. Refined icon alignment, the
  coffee support control, Settings, and compact Chrome/Firefox popup sizing.
- Improved PR-card title readability, status text/icon alignment, and wrapping.
  Pending CI/review badges retain the original yellow with white text and icons.
- Added last-successful-check information and refreshed README dashboard and
  Settings screenshots using deterministic demo data.
- Consolidated UI/theme primitives and expanded regression coverage for both
  themes, keyboard interactions, popup layout, persistence, and refresh journeys.
  Added reproducible, credential-free README screenshot capture.

Release validation covers compile, lint, 314 unit tests, 42 headed and 42
headless Chrome E2E tests, deterministic screenshot tests, and Chrome MV3 /
Firefox MV2 builds. Both generated manifests report 1.0.21. Release ZIPs retain
the original toolbar icons and popup branding; unused branding archives,
documentation images, and test/development files are excluded.

This prepares the release only. Store submission and GitHub release publishing
remain separate steps.
