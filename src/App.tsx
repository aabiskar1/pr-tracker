import { useState, useEffect } from 'react'
import browser from 'webextension-polyfill'
import { FilterBar, FilterState, SortOption } from './components/FilterBar'
import { PullRequestList } from './components/PullRequestList'
import './App.css'
import { FaGithub, FaLock, FaKey, FaUnlock, FaSignInAlt, FaShieldAlt, FaQuestionCircle, FaClock } from 'react-icons/fa'
import { encryptToken, validatePassword, hasStoredToken, hasEncryptionSetup, clearSecureStorage } from './services/secureStorage'

type PullRequest = {
  id: number
  title: string
  html_url: string
  repository: {
    name: string
  }
  state: string
  draft: boolean
  created_at: string
  requested_reviewers: { login: string, avatar_url: string }[]
  review_status?: 'approved' | 'changes-requested' | 'pending'
  ci_status?: 'passing' | 'failing' | 'pending'
}

// Define App authentication states
type AuthState = 'initializing' | 'login-needed' | 'password-setup' | 'password-entry' | 'authenticated';

function App() {
  const [token, setToken] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [confirmPassword, setConfirmPassword] = useState<string>('')
  const [rememberPassword, setRememberPassword] = useState<boolean>(false)
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([])
  const [filteredPRs, setFilteredPRs] = useState<PullRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tokenError, setTokenError] = useState<string>('')
  const [passwordError, setPasswordError] = useState<string>('')
  const [authState, setAuthState] = useState<AuthState>('initializing')
  const [showPasswordHelp, setShowPasswordHelp] = useState(false)

  // Load PRs from storage
  const loadPullRequests = async () => {
    const data = await browser.storage.local.get(['pullRequests'])
    console.log('Loaded pull requests from storage:', data.pullRequests)
    if (data.pullRequests) {
      setPullRequests(data.pullRequests as PullRequest[])
      setFilteredPRs(data.pullRequests as PullRequest[])
    }
  }

  useEffect(() => {
    // Check for token and load PRs from storage
    const initializeApp = async () => {
      try {
        // First check if we have a remembered password
        const rememberedPasswordResponse = await browser.runtime.sendMessage({
          type: 'GET_REMEMBERED_PASSWORD'
        }) as { hasRememberedPassword: boolean; password?: string };
        
        if (rememberedPasswordResponse && rememberedPasswordResponse.hasRememberedPassword && rememberedPasswordResponse.password) {
          console.log('Found remembered password, auto-signing in');
          // Set the password state
          setPassword(rememberedPasswordResponse.password);
          // Auto-authenticate
          setAuthState('authenticated');
          // Load PRs
          const data = await browser.storage.local.get(['pullRequests']);
          if (data.pullRequests) {
            setPullRequests(data.pullRequests as PullRequest[]);
            setFilteredPRs(data.pullRequests as PullRequest[]);
          }
          
          // Trigger a refresh
          browser.runtime.sendMessage({ 
            type: 'CHECK_PRS',
            password: rememberedPasswordResponse.password
          });
          
          setIsLoading(false);
          return;
        }
        
        // Continue with normal initialization if no remembered password
        // Check if encryption is set up (password has been created)
        const isEncryptionSetup = await hasEncryptionSetup();
        // Check if token exists
        const hasToken = await hasStoredToken();
        
        if (!hasToken) {
          // No token, need to login first
          setAuthState('login-needed');
        } else if (!isEncryptionSetup) {
          // Has token but no encryption setup - needs to set a password
          setAuthState('password-setup');
        } else {
          // Has both token and encryption setup - needs to enter password
          setAuthState('password-entry');
        }
        
        // Load PRs if we have a token (they'll be shown after password entry)
        const data = await browser.storage.local.get(['pullRequests']);
        if (data.pullRequests) {
          setPullRequests(data.pullRequests as PullRequest[]);
          setFilteredPRs(data.pullRequests as PullRequest[]);
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error initializing app:', error);
        setIsLoading(false);
      }
    }

    initializeApp();
    
    // Set up storage change listener to update PRs when they change
    const storageListener = (changes: Record<string, browser.Storage.StorageChange>) => {
      console.log('Storage changed:', changes)
      if (changes.pullRequests) {
        setPullRequests(changes.pullRequests.newValue as PullRequest[] || [])
        setFilteredPRs(changes.pullRequests.newValue as PullRequest[] || [])
      }
    }

    browser.storage.onChanged.addListener(storageListener)

    // Apply dark mode by default
    document.documentElement.setAttribute('data-theme', 'dark')

    return () => {
      browser.storage.onChanged.removeListener(storageListener)
    }
  }, [])

  const validateToken = async (token: string) => {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error('Invalid token');
      }
      
      // Check if token has required scopes
      const scopes = response.headers.get('x-oauth-scopes')?.split(',').map(s => s.trim()) || [];
      if (!scopes.includes('repo')) {
        throw new Error('Token needs "repo" scope. Please generate a new token with repo access.');
      }
      
      return true;
    } catch (error) {
      if (error instanceof Error) {
        setTokenError(error.message);
      } else {
        setTokenError('Failed to validate token');
      }
      return false;
    }
  };

  const handleTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setTokenError('')
    
    const isValid = await validateToken(token);
    if (isValid) {
      console.log('Token valid, moving to password setup');
      setAuthState('password-setup');
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }

  const handlePasswordSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    
    // Validate password
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      return;
    }
    
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    
    setIsLoading(true);
    try {
      // Encrypt and store the token with the new password
      await encryptToken(token, password);
      
      // Notify the background script of the password and whether to remember it
      await browser.runtime.sendMessage({ 
        type: 'SET_PASSWORD', 
        password,
        remember: rememberPassword
      });
      
      // Trigger PR check with the password
      await browser.runtime.sendMessage({ 
        type: 'CHECK_PRS',
        password
      });
      
      setAuthState('authenticated');
      
      // Wait for PRs to load
      setTimeout(async () => {
        await loadPullRequests();
        setIsLoading(false);
      }, 2000);
      
    } catch (error) {
      console.error('Error setting up password:', error);
      setPasswordError('Error setting up encryption. Please try again.');
      setIsLoading(false);
    }
  }

  const handlePasswordEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    
    if (!password) {
      setPasswordError('Please enter your password');
      return;
    }
    
    setIsLoading(true);
    try {
      // Validate the password
      const isValid = await validatePassword(password);
      if (!isValid) {
        setPasswordError('Incorrect password');
        setIsLoading(false);
        return;
      }
      
      // Send the password to the background script, including remember flag
      await browser.runtime.sendMessage({ 
        type: 'SET_PASSWORD', 
        password,
        remember: rememberPassword
      });
      
      // Trigger PR check with the password
      await browser.runtime.sendMessage({ 
        type: 'CHECK_PRS',
        password
      });
      
      setAuthState('authenticated');
      
      // Wait for PRs to load
      setTimeout(async () => {
        await loadPullRequests();
        setIsLoading(false);
      }, 2000);
      
    } catch (error) {
      console.error('Error validating password:', error);
      setPasswordError('Error validating password. Please try again.');
      setIsLoading(false);
    }
  }

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      // Clear the password from background script
      await browser.runtime.sendMessage({ type: 'CLEAR_SESSION' });
      
      // Reset state
      setPullRequests([]);
      setFilteredPRs([]);
      setToken('');
      setPassword('');
      setConfirmPassword('');
      
      // Go back to password entry (since token is still stored)
      setAuthState('password-entry');
    } catch (error) {
      console.error('Error signing out:', error);
    }
    setIsLoading(false);
  };

  const handleReset = async () => {
    if (confirm('This will remove all stored data including your GitHub token. You will need to set up the extension again. Continue?')) {
      setIsLoading(true);
      try {
        // Clear all secure storage
        await clearSecureStorage();
        
        // Clear the password from background script
        await browser.runtime.sendMessage({ type: 'CLEAR_SESSION' });
        
        // Reset state
        setPullRequests([]);
        setFilteredPRs([]);
        setToken('');
        setPassword('');
        setConfirmPassword('');
        
        // Go back to initial login
        setAuthState('login-needed');
      } catch (error) {
        console.error('Error resetting app:', error);
      }
      setIsLoading(false);
    }
  };

  const handleFilterChange = (filters: FilterState) => {
    const filtered = pullRequests.filter(pr => {
      if (pr.draft && !filters.showDrafts) return false
      if (!pr.draft && !filters.showReady) return false
      if (filters.ageFilter !== 'all') {
        const days = (Date.now() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60 * 24)
        if (filters.ageFilter === 'today' && days > 1) return false
        if (filters.ageFilter === 'week' && days > 7) return false
        if (filters.ageFilter === 'older' && days <= 7) return false
      }
      if (filters.reviewStatus.length > 0 && pr.review_status && 
          !filters.reviewStatus.includes(pr.review_status)) return false
      if (filters.ciStatus.length > 0 && pr.ci_status && 
          !filters.ciStatus.includes(pr.ci_status)) return false
      return true
    })
    setFilteredPRs(filtered)
  }

  const handleSortChange = (sort: SortOption) => {
    const sorted = [...filteredPRs].sort((a, b) => {
      switch (sort) {
        case 'newest':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        case 'urgent':
          return b.requested_reviewers.length - a.requested_reviewers.length
        case 'most-stale':
          const aReviewed = a.review_status === 'approved'
          const bReviewed = b.review_status === 'approved'
          if (aReviewed !== bReviewed) return aReviewed ? 1 : -1
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        default:
          return 0
      }
    })
    setFilteredPRs(sorted)
  }

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const searchTerm = e.target.value.toLowerCase()
    const filtered = pullRequests.filter(pr =>
      pr.title.toLowerCase().includes(searchTerm) ||
      pr.repository.name.toLowerCase().includes(searchTerm)
    )
    setFilteredPRs(filtered)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading PR Tracker...</p>
        </div>
      </div>
    )
  }

  if (authState === 'login-needed') {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md">
        <div className="flex items-center justify-center mb-6">
          <FaGithub className="text-4xl text-gray-700 dark:text-gray-300 mr-2" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">GitHub Authentication</h2>
        </div>
        
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Please enter your GitHub personal access token. Your token will be securely encrypted before storage.
        </p>
        
        <form onSubmit={handleTokenSubmit} className="space-y-4">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            aria-label="GitHub personal access token"
          />
          <button 
            type="submit" 
            className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors"
            aria-label="Save Token"
          >
            Next
          </button>
        </form>
        
        {tokenError && <p className="mt-4 text-danger font-medium" role="alert">{tokenError}</p>}
        
        <div className="mt-6 text-center">
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=PR%20Tracker"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-primary hover:underline"
            aria-label="Generate a new token with repo access"
          >
            <FaGithub className="mr-1" />
            Generate a new token with repo access
          </a>
        </div>
      </div>
    )
  }

  if (authState === 'password-setup') {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md">
        <div className="flex items-center justify-center mb-6">
          <FaLock className="text-4xl text-gray-700 dark:text-gray-300 mr-2" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Create a Password</h2>
        </div>
        
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Create a password to encrypt your GitHub token. You'll need this password each time you open PR Tracker.
        </p>
        
        <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-md mb-4 flex items-start">
          <div className="flex-shrink-0 mt-1">
            <FaShieldAlt className="text-blue-600 dark:text-blue-300" />
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Your password is never stored anywhere. It's only used to encrypt and decrypt your GitHub token.
            </p>
          </div>
        </div>
        
        <form onSubmit={handlePasswordSetup} className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="password" className="text-sm text-gray-600 dark:text-gray-300 font-medium">Password</label>
              <button 
                type="button" 
                className="text-xs text-primary flex items-center"
                onClick={() => setShowPasswordHelp(!showPasswordHelp)}
                aria-label="Password requirements"
              >
                <FaQuestionCircle className="mr-1" />
                Requirements
              </button>
            </div>
            
            {showPasswordHelp && (
              <div className="text-xs text-gray-600 dark:text-gray-300 mb-2 p-2 bg-gray-100 dark:bg-gray-700 rounded">
                <ul className="list-disc pl-4 space-y-1">
                  <li>At least 8 characters long</li>
                  <li>Remember this password - there's no recovery option!</li>
                </ul>
              </div>
            )}
            
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              aria-label="Password"
              placeholder="Enter password"
              minLength={8}
              required
            />
          </div>
          
          <div>
            <label htmlFor="confirmPassword" className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-1 block">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              aria-label="Confirm Password"
              placeholder="Confirm password"
              required
            />
          </div>
          
          <div className="flex items-center">
            <input
              id="rememberPassword"
              type="checkbox"
              checked={rememberPassword}
              onChange={(e) => setRememberPassword(e.target.checked)}
              className="h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <label htmlFor="rememberPassword" className="ml-2 block text-sm text-gray-600 dark:text-gray-300 flex items-center">
              <FaClock className="mr-1 text-gray-500 dark:text-gray-400" />
              Remember password for 24 hours
            </label>
          </div>
          
          <button 
            type="submit" 
            className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors flex items-center justify-center"
            aria-label="Create Password"
          >
            <FaKey className="mr-2" />
            Create Password & Encrypt Token
          </button>
        </form>
        
        {passwordError && <p className="mt-4 text-danger font-medium" role="alert">{passwordError}</p>}
        
        <button
          onClick={() => {
            setToken('');
            setAuthState('login-needed');
          }}
          className="w-full mt-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          aria-label="Go Back"
        >
          Go Back
        </button>
      </div>
    )
  }

  if (authState === 'password-entry') {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md">
        <div className="flex items-center justify-center mb-6">
          <FaUnlock className="text-4xl text-gray-700 dark:text-gray-300 mr-2" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Enter Password</h2>
        </div>
        
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Enter your password to decrypt your GitHub token and access your pull requests.
        </p>
        
        <form onSubmit={handlePasswordEntry} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            aria-label="Enter your password"
            required
          />
          
          <div className="flex items-center">
            <input
              id="rememberPassword"
              type="checkbox"
              checked={rememberPassword}
              onChange={(e) => setRememberPassword(e.target.checked)}
              className="h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <label htmlFor="rememberPassword" className="ml-2 block text-sm text-gray-600 dark:text-gray-300 flex items-center">
              <FaClock className="mr-1 text-gray-500 dark:text-gray-400" />
              Remember password for 24 hours
            </label>
          </div>
          
          <button 
            type="submit" 
            className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90 transition-colors flex items-center justify-center"
            aria-label="Sign In"
          >
            <FaSignInAlt className="mr-2" />
            Sign In
          </button>
        </form>
        
        {passwordError && <p className="mt-4 text-danger font-medium" role="alert">{passwordError}</p>}
        
        <button
          onClick={handleReset}
          className="w-full mt-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          aria-label="Reset App"
        >
          Reset App (Removes Saved Token)
        </button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl mx-auto p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Pull Requests</h2>
        <div className="flex space-x-2">
          <button 
            onClick={async () => {
              setIsLoading(true)
              await browser.runtime.sendMessage({ 
                type: 'CHECK_PRS',
                password
              })
              setTimeout(async () => {
                await loadPullRequests()
                setIsLoading(false)
              }, 2000)
            }}
            className="bg-primary text-white px-3 py-1 rounded-md hover:bg-primary/90 transition-colors"
            aria-label="Refresh Pull Requests"
          >
            Refresh
          </button>
          <button
            onClick={handleSignOut}
            className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            aria-label="Sign Out"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="mb-4">
        <FilterBar onFilterChange={handleFilterChange} onSortChange={handleSortChange} />
      </div>
      
      <input
        type="text"
        placeholder="Search PRs"
        className="w-full px-4 py-2 mb-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        onChange={handleSearch}
        aria-label="Search Pull Requests"
      />

      {filteredPRs.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400">No pull requests found</p>
        </div>
      ) : (
        <PullRequestList pullRequests={filteredPRs} />
      )}
    </div>
  )
}

export default App
