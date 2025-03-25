// Background script for PR Tracker
import browser from 'webextension-polyfill';
import { decryptToken, removeToken, hasStoredToken, hasEncryptionSetup } from '../services/secureStorage';

// Add types for GitHub API responses
type GitHubIssueSearchItem = {
  pull_request?: {
    url: string;
  };
}

type GitHubReview = {
  state: string;
  user: {
    id: number;
  };
}

type GitHubCheckRun = {
  conclusion: string | null;
  status: string;
}

type GitHubChecksResponse = {
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
const PASSWORD_EXPIRY_ALARM = 'password-expiry';
// Session storage for the password (never stored persistently)
let sessionPassword: string | null = null;
// Flag to track if password should be remembered
let rememberPassword: boolean = false;

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
  
  // We don't do an initial check here anymore because we need the password first
  // The popup will handle this after the user logs in
});

// Handle alarm
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Checking PRs on alarm');
    await checkPullRequests();
  } else if (alarm.name === PASSWORD_EXPIRY_ALARM) {
    console.log('Password expiry alarm triggered');
    // Clear the session password when expiry alarm triggers
    sessionPassword = null;
    rememberPassword = false;
    // Clear the alarm
    await browser.alarms.clear(PASSWORD_EXPIRY_ALARM);
  }
});

// Handle messages from popup with proper typing for WebExtension API
browser.runtime.onMessage.addListener(function(
  message: unknown,
  _sender: browser.Runtime.MessageSender,
  sendResponse: (response?: boolean | object) => void
): true {
  console.log('Received message in background:', typeof message);
  
  if (!message || typeof message !== 'object') {
    sendResponse(false);
    return true;
  }
  
  const typedMessage = message as Record<string, unknown>;
  
  // Handle the CHECK_PRS message
  if (typedMessage.type === 'CHECK_PRS') {
    console.log('Checking PRs from message');
    // Use the provided password if available
    if (typedMessage.password && typeof typedMessage.password === 'string') {
      sessionPassword = typedMessage.password;
    }
    
    // Use a Promise chain to handle the async operation
    checkPullRequests().then(() => {
      sendResponse(true);
    }).catch(error => {
      console.error('Error checking PRs:', error);
      sendResponse(false);
    });
  } 
  // Handle password setup
  else if (typedMessage.type === 'SET_PASSWORD') {
    if (typedMessage.password && typeof typedMessage.password === 'string') {
      // Store the password in memory only (not persistent)
      sessionPassword = typedMessage.password;
      
      // Handle remember option
      if (typedMessage.remember === true) {
        rememberPassword = true;
        
        // Set up expiration alarm for 24 hours from now
        const expiryTime = Date.now() + (24 * 60 * 60 * 1000); // 24 hours in milliseconds
        browser.alarms.create(PASSWORD_EXPIRY_ALARM, {
          when: expiryTime
        });
        
        console.log('Password will be remembered for 24 hours');
      } else {
        rememberPassword = false;
        // Clear any existing expiry alarm
        browser.alarms.clear(PASSWORD_EXPIRY_ALARM);
      }
      
      sendResponse(true);
    } else {
      sendResponse(false);
    }
  } 
  // Handle checking if password is remembered
  else if (typedMessage.type === 'GET_REMEMBERED_PASSWORD') {
    if (sessionPassword && rememberPassword) {
      sendResponse({
        hasRememberedPassword: true,
        password: sessionPassword
      });
    } else {
      sendResponse({
        hasRememberedPassword: false
      });
    }
  }
  // Handle password validation
  else if (typedMessage.type === 'VALIDATE_SETUP') {
    // This will check if encryption has been set up
    hasEncryptionSetup().then(isSetup => {
      sendResponse({isSetup});
    });
  }
  // Handle checking token existence
  else if (typedMessage.type === 'HAS_TOKEN') {
    hasStoredToken().then(hasToken => {
      sendResponse({hasToken});
    });
  }
  // Handle clearing password from memory
  else if (typedMessage.type === 'CLEAR_SESSION') {
    sessionPassword = null;
    rememberPassword = false;
    // Clear any expiry alarm
    browser.alarms.clear(PASSWORD_EXPIRY_ALARM);
    sendResponse(true);
  }
  else {
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
    // If we don't have the password in memory, we can't decrypt the token
    if (!sessionPassword) {
      console.log('No session password available, cannot decrypt token');
      return;
    }

    // Get the securely stored token
    const token = await decryptToken(sessionPassword);
    if (!token) {
      console.log('Failed to decrypt GitHub token');
      return;
    }

    console.log('Token decrypted successfully, fetching PRs');

    // Get user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!userResponse.ok) {
      console.error(`User info fetch failed with status: ${userResponse.status}`);
      if (userResponse.status === 401) {
        await removeToken();
      }
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
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }),
      fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(assignedQuery)}&per_page=100`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      })
    ]);

    if (!authoredResponse.ok || !reviewResponse.ok) {
      console.error(`PR search failed. Authored status: ${authoredResponse.status}, Review status: ${reviewResponse.status}`);
      if (authoredResponse.status === 401 || reviewResponse.status === 401) {
        await removeToken();
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
        // Create a notification with a unique ID
        const notificationId = `new-prs-${Date.now()}`;
        
        // Chrome requires a full path to the icon and it must be a PNG file
        // Firefox is more flexible with SVG files and relative paths
        // Use a 48x48 or 128x128 icon for best results in Chrome
        await browser.notifications.create(notificationId, {
          type: 'basic',
          iconUrl: '/icon.png', // This works in both Chrome and Firefox
          title: 'New Pull Requests',
          message: `You have ${newPrs.length} new pull request${newPrs.length > 1 ? 's' : ''}!`
        });
        
        console.log('Notification sent successfully with icon: /icon.png');
      } catch (error) {
        console.error('Error creating notification:', error);
      }
    }
    await browser.storage.local.set({ oldPullRequests: uniquePRs });

  } catch (error) {
    console.error('Error checking pull requests:', error);
    if (error instanceof Error && error.message.includes('401')) {
      await removeToken();
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
    
    // No checks? Return pending
    if (checks.check_runs.length === 0) {
      return 'pending';
    }
    
    // Define failing and passing conclusion states
    const failingConclusions = ['failure', 'cancelled', 'timed_out', 'action_required'];
    
    // Check if any checks are explicitly failing
    const hasFailingChecks = checks.check_runs.some(run => 
      run.conclusion && failingConclusions.includes(run.conclusion.toLowerCase()));
    
    if (status.state === 'failure' || hasFailingChecks) {
      return 'failing';
    }
    
    // Check for passing status
    // More permissive check: if status is success OR
    // all checks are completed AND none are failing
    if (status.state === 'success' || 
        (checks.check_runs.every(run => run.status === 'completed') && 
         !hasFailingChecks)) {
      return 'passing';
    }
    
    // If any check is in progress, consider the whole thing pending
    if (checks.check_runs.some(run => run.status === 'in_progress' || run.status === 'queued')) {
      return 'pending';
    }
    
    // Default case - if we get here, consider it pending
    return 'pending';
  } catch (error) {
    console.error('Error fetching CI status:', error);
    return 'pending';
  }
}