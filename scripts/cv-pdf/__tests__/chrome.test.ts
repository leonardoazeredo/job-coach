import { describe, expect, it } from 'vitest'
import { type ChromeEnv, findChrome } from '../chrome.ts'

// A fake machine: only the listed files exist, and directories list their children.
const machine = (files: string[], over: Partial<ChromeEnv> = {}): ChromeEnv => ({
  env: {},
  platform: 'darwin',
  home: '/home/u',
  exists: (p) => files.includes(p),
  readdir: (dir) => {
    const prefix = `${dir}/`
    const children = files
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length).split('/')[0] ?? '')
    return [...new Set(children)]
  },
  ...over,
})

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

describe('findChrome', () => {
  it('prefers CHROME_PATH over every other browser', () => {
    const env = machine(['/opt/chrome', MAC_CHROME], { env: { CHROME_PATH: '/opt/chrome' } })
    expect(findChrome(env)).toEqual({ path: '/opt/chrome' })
  })

  it('names CHROME_PATH when it points at a missing file, without falling back', () => {
    const env = machine([MAC_CHROME], { env: { CHROME_PATH: '/nope/chrome' } })
    expect(findChrome(env)).toMatchObject({
      error: expect.stringContaining('CHROME_PATH=/nope/chrome'),
    })
  })

  it('finds a common macOS install', () => {
    expect(findChrome(machine([MAC_CHROME]))).toEqual({ path: MAC_CHROME })
  })

  it('finds a common Linux install', () => {
    const env = machine(['/usr/bin/chromium'], { platform: 'linux' })
    expect(findChrome(env)).toEqual({ path: '/usr/bin/chromium' })
  })

  it('falls back to the Playwright cache, newest revision first, full build before headless shell', () => {
    const base = '/home/u/Library/Caches/ms-playwright'
    const app = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    const files = [
      `${base}/chromium-1243/chrome-mac-arm64/${app}`,
      `${base}/chromium-1248/chrome-mac-arm64/${app}`,
      `${base}/chromium_headless_shell-1250/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    ]
    expect(findChrome(machine(files))).toEqual({
      path: `${base}/chromium-1248/chrome-mac-arm64/${app}`,
    })
  })

  it('uses PLAYWRIGHT_BROWSERS_PATH and the Linux layout', () => {
    const files = ['/pw/chromium-1200/chrome-linux/chrome']
    const env = machine(files, { platform: 'linux', env: { PLAYWRIGHT_BROWSERS_PATH: '/pw' } })
    expect(findChrome(env)).toEqual({ path: '/pw/chromium-1200/chrome-linux/chrome' })
  })

  it('searches nothing but CHROME_PATH on Windows', () => {
    const env = machine([MAC_CHROME, '/usr/bin/chromium'], { platform: 'win32' })
    expect(findChrome(env)).toMatchObject({ error: expect.stringContaining('CHROME_PATH') })
  })

  it('says how to fix it when nothing is found', () => {
    expect(findChrome(machine([]))).toMatchObject({
      error: expect.stringMatching(/install Chrome.*CHROME_PATH/s),
    })
  })
})
