// Background script for PR Tracker
import { browser } from 'webextension-polyfill-ts';

interface PullRequest {
  id: number;
  title: string;
  html_url: string;
  repository: {
    name: string;
  };
  state: string;
  draft: boolean;
  created_at: string;
  requested_reviewers: { login: string }[];
}

const ALARM_NAME = 'check-prs';
const CHECK_INTERVAL = 5;

// Store the GitHub token for Firefox compatibility
let cachedToken: string | null = null;

// Initialize the extension
browser.runtime.onInstalled.addListener(async () => {
  // Set up periodic checks
  browser.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_INTERVAL
  });

  // Initialize badge
  try {
    await browser.action.setBadgeBackgroundColor({ color: '#0D47A1' });
  } catch (e) {
    // Fallback for Firefox manifest v2
    await browser.browserAction.setBadgeBackgroundColor({ color: '#0D47A1' });
  }
  
  // Initial check
  await checkPullRequests();
});

// Handle alarm
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkPullRequests();
  }
});

// Handle messages from popup
browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'CHECK_PRS') {
    await checkPullRequests();
  }
});

async function setBadgeText(text: string) {
  try {
    await browser.action.setBadgeText({ text });
  } catch (e) {
    // Fallback for Firefox manifest v2
    await browser.browserAction.setBadgeText({ text });
  }
}

async function checkPullRequests() {
  try {
    const data = await browser.storage.local.get('githubToken');
    if (!data.githubToken) return;

    cachedToken = data.githubToken;

    // Get user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${cachedToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!userResponse.ok) {
      throw new Error(`Failed to get user info: ${userResponse.status}`);
    }

    const user = await userResponse.json();

    // Fetch both authored and review-requested PRs
    const searchQuery = `is:open is:pr user:${user.login} archived:false`;
    const assignedQuery = `is:open is:pr review-requested:${user.login} archived:false`;

    const [authoredResponse, reviewResponse] = await Promise.all([
      fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`, {
        headers: {
          'Authorization': `Bearer ${cachedToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }),
      fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(assignedQuery)}&per_page=100`, {
        headers: {
          'Authorization': `Bearer ${cachedToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      })
    ]);

    if (!authoredResponse.ok || !reviewResponse.ok) {
      if (authoredResponse.status === 401 || reviewResponse.status === 401) {
        await browser.storage.local.remove('githubToken');
        cachedToken = null;
      }
      throw new Error(`Failed to fetch PRs: ${authoredResponse.status}, ${reviewResponse.status}`);
    }

    const authoredData = await authoredResponse.json();
    const reviewData = await reviewResponse.json();

    // Get full PR details
    const getPRDetails = async (item: any) => {
      try {
        const prUrl = item.pull_request.url;
        const response = await fetch(prUrl, {
          headers: {
            'Authorization': `Bearer ${cachedToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (!response.ok) {
          console.error(`Failed to fetch PR details: ${response.status}`);
          return null;
        }

        return await response.json();
      } catch (error) {
        console.error('Error fetching PR details:', error);
        return null;
      }
    };

    const authoredPRs = (await Promise.all(authoredData.items.map(getPRDetails))).filter(Boolean);
    const reviewPRs = (await Promise.all(reviewData.items.map(getPRDetails))).filter(Boolean);

    // Combine and deduplicate PRs
    const allPRs = [...authoredPRs, ...reviewPRs];
    const uniquePRs = Array.from(new Map(allPRs.map(pr => [pr.id, {
      id: pr.id,
      title: pr.title,
      html_url: pr.html_url,
      repository: {
        name: pr.base.repo.name
      },
      state: pr.state,
      draft: pr.draft,
      created_at: pr.created_at,
      requested_reviewers: pr.requested_reviewers || []
    }])).values());

    const count = uniquePRs.length;
    await setBadgeText(count > 0 ? count.toString() : '');
    await browser.storage.local.set({ pullRequests: uniquePRs });

    // Handle notifications
    const oldPrs = ((await browser.storage.local.get('oldPullRequests')).oldPullRequests || []) as PullRequest[];
    const newPrs = uniquePRs.filter(pr => !oldPrs.find(old => old.id === pr.id));

    if (newPrs.length > 0) {
      browser.notifications.create({
        type: 'basic',
        iconUrl: 'icon.svg',
        title: 'New Pull Requests',
        message: `You have ${newPrs.length} new pull request${newPrs.length > 1 ? 's' : ''}!`
      });
    }

    await browser.storage.local.set({ oldPullRequests: uniquePRs });

  } catch (error) {
    console.error('Error checking pull requests:', error);
    if (error instanceof Error && error.message.includes('401')) {
      await browser.storage.local.remove('githubToken');
      cachedToken = null;
    }
  }
}