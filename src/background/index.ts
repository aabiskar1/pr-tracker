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
  console.log('PR Tracker extension installed');
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
    console.log('Checking PRs on alarm');
    await checkPullRequests();
  }
});

// Handle messages from popup
browser.runtime.onMessage.addListener(async (message) => {
  console.log('Received message in background:', message);
  if (message.type === 'CHECK_PRS') {
    console.log('Checking PRs from message');
    await checkPullRequests();
    return true; // Important: return true for async listeners
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
  console.log('Starting PR check');
  try {
    const data = await browser.storage.local.get('githubToken');
    if (!data.githubToken) {
      console.log('No GitHub token found');
      return;
    }

    console.log('Token found, fetching PRs');
    cachedToken = data.githubToken;

    // Get user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${cachedToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!userResponse.ok) {
      console.error(`User info fetch failed with status: ${userResponse.status}`);
      throw new Error(`Failed to get user info: ${userResponse.status}`);
    }

    const user = await userResponse.json();
    console.log(`Fetched user info for ${user.login}`);

    // Fetch both authored and review-requested PRs
    const searchQuery = `is:open is:pr author:${user.login} archived:false`;
    const assignedQuery = `is:open is:pr review-requested:${user.login} archived:false`;

    console.log(`Searching for PRs with queries: 
      - Authored: ${searchQuery}
      - Review requested: ${assignedQuery}`);

    const [authoredResponse, reviewResponse] = await Promise.all([
      fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`, {
        headers: {
          'Authorization': `token ${cachedToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }),
      fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(assignedQuery)}&per_page=100`, {
        headers: {
          'Authorization': `token ${cachedToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      })
    ]);

    if (!authoredResponse.ok || !reviewResponse.ok) {
      console.error(`PR search failed. Authored status: ${authoredResponse.status}, Review status: ${reviewResponse.status}`);
      if (authoredResponse.status === 401 || reviewResponse.status === 401) {
        await browser.storage.local.remove('githubToken');
        cachedToken = null;
      }
      throw new Error(`Failed to fetch PRs: ${authoredResponse.status}, ${reviewResponse.status}`);
    }

    const authoredData = await authoredResponse.json();
    const reviewData = await reviewResponse.json();

    console.log(`Found ${authoredData.items.length} authored PRs and ${reviewData.items.length} review requested PRs`);

    // Get full PR details
    const getPRDetails = async (item: any) => {
      try {
        if (!item.pull_request || !item.pull_request.url) {
          console.error('Item missing pull_request URL:', item);
          return null;
        }
        
        const prUrl = item.pull_request.url;
        console.log(`Fetching details for PR: ${prUrl}`);
        
        const response = await fetch(prUrl, {
          headers: {
            'Authorization': `token ${cachedToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (!response.ok) {
          console.error(`Failed to fetch PR details: ${response.status} for ${prUrl}`);
          return null;
        }

        const prData = await response.json();
        console.log(`Successfully fetched details for PR: ${prData.title}`);
        return prData;
      } catch (error) {
        console.error('Error fetching PR details:', error);
        return null;
      }
    };

    console.log('Fetching detailed PR information...');
    const authoredPRs = (await Promise.all(authoredData.items.map(getPRDetails))).filter(Boolean);
    const reviewPRs = (await Promise.all(reviewData.items.map(getPRDetails))).filter(Boolean);
    console.log(`Successfully fetched details for ${authoredPRs.length} authored PRs and ${reviewPRs.length} review PRs`);

    // Combine and deduplicate PRs
    const allPRs = [...authoredPRs, ...reviewPRs];
    
    // Map each PR to our simplified format, handling potential undefined properties safely
    const uniquePRs = Array.from(new Map(allPRs.map(pr => {
      try {
        // Create a safe repo name, handling the case where base.repo might be undefined
        const repoName = pr.base && pr.base.repo && pr.base.repo.name 
          ? pr.base.repo.name 
          : pr.repository && pr.repository.name
            ? pr.repository.name
            : pr.html_url.split('/')[4]; // Extract from URL as fallback
            
        return [pr.id, {
          id: pr.id,
          title: pr.title || 'Untitled PR',
          html_url: pr.html_url,
          repository: {
            name: repoName
          },
          state: pr.state || 'open',
          draft: pr.draft || false,
          created_at: pr.created_at || new Date().toISOString(),
          requested_reviewers: pr.requested_reviewers || []
        }];
      } catch (err) {
        console.error('Error processing PR:', err, pr);
        return null;
      }
    }).filter(Boolean) as [number, PullRequest][]).values());

    const count = uniquePRs.length;
    console.log(`Final count of unique PRs: ${count}`);
    await setBadgeText(count > 0 ? count.toString() : '');
    
    console.log('Saving PRs to storage:', uniquePRs);
    await browser.storage.local.set({ pullRequests: uniquePRs });

    // Handle notifications
    const oldPrs = ((await browser.storage.local.get('oldPullRequests')).oldPullRequests || []) as PullRequest[];
    const newPrs = uniquePRs.filter(pr => !oldPrs.find(old => old.id === pr.id));

    if (newPrs.length > 0) {
      console.log(`Sending notification for ${newPrs.length} new PRs`);
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