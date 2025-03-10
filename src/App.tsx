import { useState, useEffect } from 'react'
import browser from 'webextension-polyfill'
import { FilterBar, FilterState, SortOption } from './components/FilterBar'
import './App.css'
import { FaExclamationCircle, FaMoon, FaSun, FaGithub } from 'react-icons/fa'

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
}

function App() {
  const [token, setToken] = useState<string>('')
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([])
  const [filteredPRs, setFilteredPRs] = useState<PullRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tokenError, setTokenError] = useState<string>('')
  const [darkMode, setDarkMode] = useState<boolean>(false)

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
    // Load token and PRs from storage
    browser.storage.local.get(['githubToken', 'pullRequests']).then((data) => {
      console.log('Initial storage load, token exists:', !!data.githubToken)
      if (data.githubToken) {
        setToken(data.githubToken as string)
      }
      if (data.pullRequests) {
        setPullRequests(data.pullRequests as PullRequest[])
        setFilteredPRs(data.pullRequests as PullRequest[])
      }
      setIsLoading(false)
    })

    // Set up storage change listener to update PRs when they change
    const storageListener = (changes: Record<string, browser.Storage.StorageChange>) => {
      console.log('Storage changed:', changes)
      if (changes.pullRequests) {
        setPullRequests(changes.pullRequests.newValue as PullRequest[] || [])
        setFilteredPRs(changes.pullRequests.newValue as PullRequest[] || [])
      }
      if (changes.githubToken) {
        console.log('Token changed:', !!changes.githubToken.newValue)
        setToken(changes.githubToken.newValue as string || '')
      }
    }

    browser.storage.onChanged.addListener(storageListener)

    // Set initial dark/light mode based on user preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setDarkMode(true)
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.setAttribute('data-theme', 'light')
    }

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
      console.log('Token valid, saving to storage:', token.substring(0, 5) + '...')
      try {
        await browser.storage.local.set({ githubToken: token })
        console.log('Token saved to storage')
        
        // Verify token was saved
        const check = await browser.storage.local.get('githubToken')
        console.log('Token verification:', !!check.githubToken)
        
        await browser.runtime.sendMessage({ type: 'CHECK_PRS' })
        console.log('Sent CHECK_PRS message')
        
        // Wait a moment then manually load PRs to ensure we get the latest data
        setTimeout(async () => {
          await loadPullRequests()
          setIsLoading(false)
        }, 2000) // 2 second delay to allow background process to fetch PRs
      } catch (error) {
        console.error('Error saving token:', error)
        setTokenError('Error saving token')
        setIsLoading(false)
      }
    } else {
      setIsLoading(false)
    }
  }

  const handleFilterChange = (filters: FilterState) => {
    const filtered = pullRequests.filter(pr => {
      if (pr.draft && !filters.showDrafts) return false
      if (!pr.draft && !filters.showReady) return false
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

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
    document.documentElement.setAttribute('data-theme', darkMode ? 'light' : 'dark')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading your pull requests...</p>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow-md">
        <div className="flex items-center justify-center mb-6">
          <FaGithub className="text-4xl text-gray-700 dark:text-gray-300 mr-2" />
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">GitHub Authentication</h2>
        </div>
        
        <p className="text-gray-600 dark:text-gray-300 mb-4">Please enter your GitHub personal access token:</p>
        
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
            Save Token
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
        
        <button 
          onClick={toggleDarkMode}
          className="absolute top-2 right-2 p-2 rounded-full bg-gray-200 dark:bg-gray-700 transition-colors"
          title="Toggle Dark Mode"
          aria-label="Toggle Dark Mode"
        >
          {darkMode ? <FaSun className="text-yellow-500" /> : <FaMoon className="text-gray-700" />}
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
              // Check if token exists before refreshing
              const data = await browser.storage.local.get('githubToken')
              console.log('Refresh clicked, token exists:', !!data.githubToken)
              if (!data.githubToken && token) {
                console.log('Token missing from storage but exists in state, re-saving')
                await browser.storage.local.set({ githubToken: token })
              }
              await browser.runtime.sendMessage({ type: 'CHECK_PRS' })
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
            onClick={toggleDarkMode} 
            className="p-2 rounded-full bg-gray-200 dark:bg-gray-700 transition-colors"
            title="Toggle Dark Mode" 
            aria-label="Toggle Dark Mode"
          >
            {darkMode ? <FaSun className="text-yellow-500" /> : <FaMoon className="text-gray-700" />}
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
        <ul className="space-y-3">
          {filteredPRs.map((pr) => (
            <li 
              key={pr.id} 
              className={`rounded-lg border dark:border-gray-700 hover:shadow-md transition-shadow ${pr.draft ? 'bg-gray-50 dark:bg-gray-900/30' : 'bg-white dark:bg-gray-700'}`}
            >
              <a 
                href={pr.html_url}
                target="_blank" 
                rel="noopener noreferrer"
                className="block p-4"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <span className="inline-block px-2 py-1 text-xs font-medium rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 mb-2">
                      {pr.repository.name}
                    </span>
                    
                    <h3 className="font-medium text-gray-800 dark:text-white mb-1">
                      {pr.title}
                      {pr.draft && (
                        <span className="ml-2 px-2 py-0.5 text-xs rounded bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300">
                          Draft
                        </span>
                      )}
                    </h3>
                    
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Created {new Date(pr.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  
                  {pr.state === 'urgent' && (
                    <FaExclamationCircle className="text-danger" aria-label="Urgent Pull Request" />
                  )}
                </div>
                
                {pr.requested_reviewers.length > 0 && (
                  <div className="mt-3 flex items-center">
                    <div className="flex -space-x-1 mr-2">
                      {pr.requested_reviewers.map(reviewer => (
                        <img
                          key={reviewer.login}
                          src={reviewer.avatar_url}
                          alt={reviewer.login}
                          className="w-6 h-6 rounded-full border border-white dark:border-gray-800"
                          aria-label={`Reviewer: ${reviewer.login}`}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {pr.requested_reviewers.length} reviewer{pr.requested_reviewers.length !== 1 ? 's' : ''} requested
                    </span>
                  </div>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default App
