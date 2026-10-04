# Unused Watchtower extension icons

This folder preserves all six PNG assets from the former Watchtower toolbar
icon set, copied byte-for-byte from commit `ec7ffb9` before the original PR
Tracker extension icons were restored. The original relative paths are kept:

- `icon.png`
- `icons/icon.png`
- `icons/icon-16.png`
- `icons/icon-32.png`
- `icons/icon-48.png`
- `icons/icon-128.png`

These are archived assets for possible future use. They are outside `public/`,
are not referenced by application code or manifests, and are not included in
Chrome or Firefox extension builds.

The active browser icons remain in `public/icons/`. The separate active popup
branding asset remains `public/branding/watchtower.png`.
