import { useState, useEffect } from 'react'
import { browser } from 'webextension-polyfill-ts'
import { FilterBar, FilterState, SortOption } from './components/FilterBar'
import './App.css'
import { FaExclamationCircle, FaMoon, FaSun } from 'react-icons/fa'

interface PullRequest {
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
      setPullRequests(data.pullRequests)
      setFilteredPRs(data.pullRequests)
    }
  }

  useEffect(() => {
    // Load token and PRs from storage
    browser.storage.local.get(['githubToken', 'pullRequests']).then((data) => {
      console.log('Initial storage load, token exists:', !!data.githubToken)
      if (data.githubToken) {
        setToken(data.githubToken)
      }
      if (data.pullRequests) {
        setPullRequests(data.pullRequests)
        setFilteredPRs(data.pullRequests)
      }
      setIsLoading(false)
    })

    // Set up storage change listener to update PRs when they change
    const storageListener = (changes: any) => {
      console.log('Storage changed:', changes)
      if (changes.pullRequests) {
        setPullRequests(changes.pullRequests.newValue || [])
        setFilteredPRs(changes.pullRequests.newValue || [])
      }
      if (changes.githubToken) {
        console.log('Token changed:', !!changes.githubToken.newValue)
        setToken(changes.githubToken.newValue)
      }
    }

    browser.storage.onChanged.addListener(storageListener)

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
    return <div className="container">Loading...</div>
  }

  if (!token) {
    return (
      <div className="container">
        <h2>GitHub Authentication</h2>
        <p>Please enter your GitHub personal access token:</p>
        <form onSubmit={handleTokenSubmit}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            className="token-input"
            aria-label="GitHub personal access token"
          />
          <button type="submit" aria-label="Save Token">Save Token</button>
        </form>
        {tokenError && <p className="error-text" role="alert">{tokenError}</p>}
        <p className="help-text">
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=PR%20Tracker"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Generate a new token with repo access"
          >
            Generate a new token with repo access
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className={`container ${darkMode ? 'dark' : 'light'}`}>
      <h2>Pull Requests</h2>
      <div className="actions">
        <button onClick={async () => {
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
        }} aria-label="Refresh Pull Requests">Refresh</button>
        <button onClick={toggleDarkMode} title="Toggle Dark Mode" aria-label="Toggle Dark Mode">
          {darkMode ? <FaSun /> : <FaMoon />}
        </button>
      </div>
      <FilterBar onFilterChange={handleFilterChange} onSortChange={handleSortChange} />
      <input
        type="text"
        placeholder="Search PRs"
        className="search-input"
        onChange={handleSearch}
        aria-label="Search Pull Requests"
      />
      {filteredPRs.length === 0 ? (
        <p>No pull requests assigned to you.</p>
      ) : (
        <ul className="pr-list">
          {filteredPRs.map((pr) => (
            <li key={pr.id} className={`pr-item ${pr.state === 'urgent' ? 'urgent' : ''}`}>
              <a href={pr.html_url} target="_blank" rel="noopener noreferrer">
                <span className="repo-name">{pr.repository.name}</span>
                <span className="pr-title">{pr.title}</span>
                {pr.draft && <span className="pr-draft">Draft</span>}
                {pr.requested_reviewers.length > 0 && (
                  <span className="pr-reviewers">
                    {pr.requested_reviewers.map(reviewer => (
                      <img
                        key={reviewer.login}
                        src={reviewer.avatar_url}
                        alt={reviewer.login}
                        className="reviewer-avatar"
                        aria-label={`Reviewer: ${reviewer.login}`}
                      />
                    ))}
                    {pr.requested_reviewers.length} reviewer{pr.requested_reviewers.length !== 1 ? 's' : ''} requested
                  </span>
                )}
                {pr.state === 'urgent' && <FaExclamationCircle className="urgent-icon" aria-label="Urgent Pull Request" />}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default App
