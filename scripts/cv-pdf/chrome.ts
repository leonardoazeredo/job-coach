import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Everything the lookup reads from the machine, so tests can describe one.
export type ChromeEnv = {
  env: Record<string, string | undefined>
  platform: string
  home: string
  exists: (path: string) => boolean
  readdir: (dir: string) => string[]
}

export type ChromeFound = { path: string } | { error: string }

const MAC_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]

const LINUX_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

// Where a Playwright browser folder keeps its binary. The full build comes before the
// headless shell because the verifier was written against full Chrome's text layer.
const PLAYWRIGHT_BINARIES = [
  {
    folder: /^chromium-(\d+)$/,
    binaries: [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-linux/chrome',
      'chrome-linux64/chrome',
    ],
  },
  {
    folder: /^chromium_headless_shell-(\d+)$/,
    binaries: [
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-headless-shell-mac-x64/chrome-headless-shell',
      'chrome-headless-shell-linux64/chrome-headless-shell',
      'chrome-linux/headless_shell',
    ],
  },
]

const NOT_FOUND =
  'no Chrome-family browser found: install Chrome (or Chromium), or set CHROME_PATH to its executable'

const playwrightCache = (e: ChromeEnv): string =>
  e.env.PLAYWRIGHT_BROWSERS_PATH ??
  (e.platform === 'darwin'
    ? join(e.home, 'Library', 'Caches', 'ms-playwright')
    : join(e.home, '.cache', 'ms-playwright'))

const fromPlaywright = (e: ChromeEnv): string | undefined => {
  const cache = playwrightCache(e)
  let folders: string[]
  try {
    folders = e.readdir(cache)
  } catch {
    return undefined
  }
  for (const { folder, binaries } of PLAYWRIGHT_BINARIES) {
    const newestFirst = folders
      .map((name) => ({ name, rev: Number(folder.exec(name)?.[1]) }))
      .filter((f) => Number.isFinite(f.rev))
      .sort((a, b) => b.rev - a.rev)
    for (const { name } of newestFirst) {
      const hit = binaries.map((b) => join(cache, name, b)).find(e.exists)
      if (hit) return hit
    }
  }
  return undefined
}

// Windows has no search: its install paths vary too much to guess, so it relies on CHROME_PATH.
export const findChrome = (e: ChromeEnv = realEnv()): ChromeFound => {
  const chosen = e.env.CHROME_PATH
  if (chosen) {
    return e.exists(chosen)
      ? { path: chosen }
      : { error: `CHROME_PATH=${chosen} does not exist; point CHROME_PATH at a Chrome executable` }
  }
  if (e.platform === 'win32') return { error: `${NOT_FOUND} (Windows needs CHROME_PATH)` }
  const common = e.platform === 'darwin' ? MAC_PATHS : LINUX_PATHS
  const path = common.find(e.exists) ?? fromPlaywright(e)
  return path ? { path } : { error: NOT_FOUND }
}

export const realEnv = (): ChromeEnv => ({
  env: process.env,
  platform: process.platform,
  home: homedir(),
  exists: existsSync,
  readdir: readdirSync,
})
