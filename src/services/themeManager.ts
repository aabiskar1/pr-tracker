import browser from 'webextension-polyfill'

const THEME_KEY = 'theme-preference' // 'light', 'dark', or 'auto'

export type ThemePreference = 'light' | 'dark' | 'auto'

export async function getStoredTheme(): Promise<ThemePreference> {
  const { [THEME_KEY]: theme } = await browser.storage.local.get(THEME_KEY)
  return theme || 'auto'
}

export async function setStoredTheme(theme: ThemePreference) {
  await browser.storage.local.set({ [THEME_KEY]: theme })
}

export function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: ThemePreference) {
  const effectiveTheme = theme === 'auto' ? getSystemTheme() : theme
  document.documentElement.setAttribute('data-theme', effectiveTheme)
}

export function listenToSystemThemeChanges(callback: (theme: 'light' | 'dark') => void) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    callback(e.matches ? 'dark' : 'light')
  })
}
