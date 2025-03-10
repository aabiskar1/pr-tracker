# PR Tracker - GitHub Pull Request Management Extension

A browser extension to help you efficiently track and manage your GitHub pull requests. The extension provides status updates, filtering capabilities, and visual indicators for PR age, review status, and CI/build status.

## Features

- **PR Status Tracking**:
  - Visual indicators for PR age and staleness
  - Review status (approved, changes requested, pending)
  - CI/build status indicators
  - Draft PR indicators

- **Advanced Filtering**:
  - Filter by PR age (today, this week, older)
  - Filter by review status
  - Filter by CI status
  - Filter draft vs. ready PRs
  - Full text search across PR titles and repositories

- **Smart Sorting Options**:
  - Sort by newest/oldest
  - Sort by urgency (based on reviewer count)
  - Sort by staleness (prioritizing unreviewed PRs)

- **Visual Features**:
  - Dark/Light mode support
  - Reviewer avatars and counts
  - Status badges with intuitive colors
  - Timestamp indicators

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/pr-tracker.git
   cd pr-tracker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   - For Chrome:
     ```bash
     npm run build:chrome
     ```
   - For Firefox:
     ```bash
     npm run build:firefox
     ```

4. Load the extension:
   - Chrome:
     1. Open `chrome://extensions/`
     2. Enable "Developer mode"
     3. Click "Load unpacked"
     4. Select the `dist-chrome` directory

   - Firefox:
     1. Open `about:debugging`
     2. Click "This Firefox"
     3. Click "Load Temporary Add-on"
     4. Select any file from the `dist-firefox` directory

## Usage

1. After installation, click the extension icon in your browser toolbar
2. Generate a GitHub personal access token with `repo` scope
3. Enter your token in the extension's authentication screen
4. Start tracking your PRs!

## Development

The extension is built with:
- React + TypeScript
- Vite for building
- TailwindCSS for styling
- GitHub API v3

To start development:

```bash
npm run dev
```

For production builds:
```bash
npm run build:chrome   # For Chrome
npm run build:firefox  # For Firefox
```