Features

    Display Assigned Pull Requests:

        Show a badge with the number of assigned PRs on the extension icon.

        List all pull requests currently assigned to the user in a popup.

    Quick Access to PRs:

        Allow users to click on a PR in the list to open it directly in their browser.

    Authentication and Setup:

        Implement GitHub authentication using a personal access token.

        Guide users to create a token with the necessary permissions (e.g., repo scope).

    Pull Request Details:

        Show relevant information for each PR, such as title, repository, and status.

    Filtering and Sorting:

        Enable users to filter PRs by status (e.g., draft, ready for review).

        Allow sorting of PRs by various criteria like creation date or urgency.

    Notifications:

        Provide desktop notifications for new PR assignments or updates.

    Refresh Mechanism:

        Implement an automatic refresh feature to keep the PR list up-to-date.

Implementation Steps

    Create the Extension Structure:

        Create a basic directory structure for your extension with files like manifest.json, popup.html, popup.js, and background.js.

    Implement Authentication:

        Use GitHub's API to authenticate users via a personal access token.

        Store the token securely using the browser's storage API.

    Fetch and Display PRs:

        Use the GitHub API to fetch PRs assigned to the user.

        Display them in the popup with relevant details.

    Add Click-to-Open Functionality:

        Implement a click handler to open the selected PR in a new tab.

    Implement Filtering and Sorting:

        Add UI elements (e.g., dropdowns) to filter and sort PRs.

    Add Notification Support:

        Use the browser's notification API to notify users of new PR assignments.

    Test and Refine:

        Test the extension thoroughly and refine its functionality based on feedback.
