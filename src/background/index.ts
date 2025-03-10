// Background script for PR Tracker
import browser from 'webextension-polyfill';

// Add interface for GitHub API responses
interface GitHubIssueSearchItem {
  pull_request?: {
    url: string;
  };
}

interface GitHubReview {
  state: string;
  user: {
    id: number;
  };
}

interface GitHubCheckRun {
  conclusion: string;
}

interface GitHubChecksResponse {
  check_runs: GitHubCheckRun[];
}

type PullRequest = {
  id: number;
  title: string;
  html_url: string;
  repository: {
    name: string;
  };
  state: string;
  draft: boolean;
  created_at: string;
  requested_reviewers: { login: string; avatar_url: string }[];
  review_status?: 'approved' | 'changes-requested' | 'pending';
  ci_status?: 'passing' | 'failing' | 'pending';
};

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

// Handle messages from popup with proper typing for WebExtension API
browser.runtime.onMessage.addListener(function(
  message: unknown,
  _sender: browser.Runtime.MessageSender,
  sendResponse: (response?: boolean) => void
): true {
  console.log('Received message in background:', message);
  
  // Type guard to check if message is the expected format
  if (message && typeof message === 'object' && 'type' in message && 
      (message as {type: string}).type === 'CHECK_PRS') {
    console.log('Checking PRs from message');
    // Use a Promise chain to handle the async operation
    checkPullRequests().then(() => {
      sendResponse(true);
    }).catch(error => {
      console.error('Error checking PRs:', error);
      sendResponse(false);
    });
  } else {
    // Always send a response even if we don't recognize the message
    sendResponse(false);
  }
  
  // Always return true to indicate we'll handle the response asynchronously
  return true;
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
    cachedToken = data.githubToken as string;

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
    const getPRDetails = async (item: GitHubIssueSearchItem, token: string) => {
      try {
        if (!item.pull_request || typeof item.pull_request !== 'object' || !('url' in item.pull_request)) {
          console.error('Item missing pull_request URL:', item);
          return null;
        }

        const prUrl = item.pull_request.url as string;
        console.log(`Fetching details for PR: ${prUrl}`);
        
        const [prData, reviewStatus, ciStatus] = await Promise.all([
          fetch(prUrl, {
            headers: {
              'Authorization': `token ${token}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          }).then(r => r.json()),
          getReviewStatus(prUrl, token),
          getCIStatus(prUrl, token)
        ]);

        console.log(`Successfully fetched details for PR: ${prData.title}`);
        return {
          ...prData,
          review_status: reviewStatus,
          ci_status: ciStatus
        };
      } catch (error) {
        console.error('Error fetching PR details:', error);
        return null;
      }
    };

    console.log('Fetching detailed PR information...');
    if (!cachedToken) {
      throw new Error('Token not available');
    }

    // We know cachedToken is not null here due to the check above
    const token = cachedToken;
    const authoredPRs = (await Promise.all(authoredData.items.map((item: GitHubIssueSearchItem) => 
      getPRDetails(item, token)
    ))).filter(Boolean);
    const reviewPRs = (await Promise.all(reviewData.items.map((item: GitHubIssueSearchItem) => 
      getPRDetails(item, token)
    ))).filter(Boolean);
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
          requested_reviewers: pr.requested_reviewers || [],
          review_status: pr.review_status,
          ci_status: pr.ci_status
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
      try {
        await browser.notifications.create({
          type: 'basic',
          iconUrl: 'icon.svg',
          title: 'New Pull Requests',
          message: `You have ${newPrs.length} new pull request${newPrs.length > 1 ? 's' : ''}!`
        });
      } catch (error) {
        console.error('Error creating notification:', error);
      }
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

async function getReviewStatus(prUrl: string, token: string): Promise<'approved' | 'changes-requested' | 'pending'> {
  try {
    const response = await fetch(`${prUrl}/reviews`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch review status: ${response.status}`);
      return 'pending';
    }

    const reviews = await response.json();
    
    // Get the latest review from each reviewer
    const latestReviews = new Map();
    reviews.forEach((review: GitHubReview) => {
      if (review.state && review.user) {
        latestReviews.set(review.user.id, review.state);
      }
    });

    const reviewStates = Array.from(latestReviews.values());
    
    if (reviewStates.includes('CHANGES_REQUESTED')) {
      return 'changes-requested';
    }
    if (reviewStates.length > 0 && reviewStates.every(state => state === 'APPROVED')) {
      return 'approved';
    }
    return 'pending';
  } catch (error) {
    console.error('Error fetching review status:', error);
    return 'pending';
  }
}

async function getCIStatus(prUrl: string, token: string): Promise<'passing' | 'failing' | 'pending'> {
  try {
    // The commits endpoint includes the combined status and check runs
    const response = await fetch(`${prUrl}/commits`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch CI status: ${response.status}`);
      return 'pending';
    }

    const commits = await response.json();
    if (commits.length === 0) {
      return 'pending';
    }

    const lastCommit = commits[commits.length - 1];
    const statusUrl = lastCommit.url + '/status';
    const checksUrl = lastCommit.url + '/check-runs';

    const [statusResponse, checksResponse] = await Promise.all([
      fetch(statusUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }),
      fetch(checksUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      })
    ]);

    const status = await statusResponse.json();
    const checks = (await checksResponse.json()) as GitHubChecksResponse;

    // Check if any status checks are failing
    if (status.state === 'failure' || checks.check_runs.some((run: GitHubCheckRun) => run.conclusion === 'failure')) {
      return 'failing';
    }
    // Check if all status checks are successful
    if (status.state === 'success' && checks.check_runs.every((run: GitHubCheckRun) => run.conclusion === 'success')) {
      return 'passing';
    }
    // Otherwise, some checks are still pending
    return 'pending';
  } catch (error) {
    console.error('Error fetching CI status:', error);
    return 'pending';
  }
}