# Testing PR Tracker Extension

This document provides details on how to test the PR Tracker browser extension using WebDriverIO.

## Prerequisites

- Node.js 16 or later
- Chrome and/or Firefox installed
- Extension built for the respective browsers:
    - Run `npm run build:chrome` for Chrome testing
    - Run `npm run build:firefox` for Firefox testing

## Setting Up Authentication for Testing

The extension requires a GitHub personal access token for authentication. To simplify testing, we use a `.env.test` file to store your token:

1. Create or modify the `.env.test` file in the project root:

```
# Environment variables for testing
# Set your GitHub token below for automated authentication in tests
GITHUB_TOKEN=your_github_token_here
```

2. Replace `your_github_token_here` with a valid GitHub token that has the necessary permissions (`repo` scope).

> **IMPORTANT**: Never commit your `.env.test` file to version control. It's already added to `.gitignore`.

## Running Tests

### Basic Extension Tests

Test the extension UI components:

```
npm run test:extension:chrome
npm run test:extension:firefox
```

### Authenticated Extension Tests

Test the extension with automatic GitHub authentication:

```
npm run test:extension:auth
```

This command will:

1. Load the extension in Chrome
2. Use the GitHub token from your `.env.test` file
3. Automatically authenticate in the extension
4. Verify that PR data is loaded and displayed

### Debug Mode

To run tests with a visible browser window (not headless):

```
npm run test:extension:chrome:debug
npm run test:extension:firefox:debug
```

## Test Structure

- `ExtensionBrowserTest.ts`: Tests browser-specific extension loading and UI functionality
- `ExtensionE2E.test.ts`: End-to-end tests that verify core extension features
- `Extension.test.ts`: Basic extension component and functionality tests

## Helper Functions

Several helper modules are available to assist with testing:

- `authHelper.ts`: Functions for authenticating with GitHub token
- `extensionHelper.ts`: Utilities for locating and interacting with the browser extension
- `utils.ts`: General testing utilities

## Adding New Tests

When adding new tests, follow these guidelines:

1. Use the authentication helpers when testing features that require being logged in
2. Use selectors that work in both Chrome and Firefox
3. Add appropriate timeouts and waits for asynchronous operations
4. Handle both authenticated and unauthenticated states where appropriate

## Troubleshooting

- **Extension not found**: Make sure you've built the extension before running tests
- **Authentication failing**: Verify your GitHub token is valid and has the correct permissions
- **Element not found errors**: Check that selectors work in both Chrome and Firefox
- **Tests timing out**: Increase the timeout values in the appropriate wait calls
