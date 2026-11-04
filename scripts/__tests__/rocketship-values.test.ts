import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ROCKETSHIP_COUNTRIES,
  ROCKETSHIP_EMPLOYMENT,
  ROCKETSHIP_STACK,
  rocketshipBoard,
} from '../lib/boards/rocketship.ts'
import { fakeFetch, fixture, html, json, search, sleep } from './board-fakes.ts'

const index = fixture('rocketship-index.html')
const empty = { pageProps: { initialJobOpenings: [], initialTotalJobCount: 6 } }
// The build id in the recorded index page; see rocketship.test.ts.
const isData = (u: URL) => u.pathname.startsWith('/_next/data/build-0000-fixture01/')

describe('rocketship country, employment type and stack values', () => {
  const pullWith = async (change: Partial<typeof search>) => {
    const lines: string[] = []
    const { fetch, urls } = fakeFetch((u) => (isData(u) ? json(empty) : html(index)))
    await rocketshipBoard({
      fetch,
      sleep,
      log: (line) => lines.push(line),
      search: {
        ...search,
        country: 'Germany',
        stack: ['React'],
        employment: 'full-time',
        ...change,
      },
      searchTitles: ['Frontend Engineer'],
    }).pull()
    return { warnings: lines.filter((l) => l.startsWith('warning: profile/')), urls }
  }

  it('stays quiet when every value is one the board takes', async () => {
    const { warnings } = await pullWith({})
    expect(warnings).toEqual([])
  })

  it('says a misspelt country falls back to worldwide-remote roles, and still sends it', async () => {
    const { warnings, urls } = await pullWith({ country: 'Czech Republic' })
    expect(warnings).toEqual([
      'warning: profile/search.yaml country "Czech Republic" is not a place Remote Rocketship knows, so the search falls back to worldwide-remote roles only; the names are in its location filter, for example United Kingdom, Germany, Czechia',
    ])
    expect(urls.filter(isData)[0]?.searchParams.get('locations')).toBe('Czech Republic')
  })

  it('says an unknown employment type makes the board answer nothing, and still sends it', async () => {
    const { warnings, urls } = await pullWith({ employment: 'permanent' })
    expect(warnings).toEqual([
      'warning: profile/search.yaml employment "permanent" is not a type Remote Rocketship knows, so it answers every title with nothing; it takes full-time, part-time, contract, internship',
    ])
    expect(urls.filter(isData)[0]?.searchParams.get('employmentType')).toBe('permanent')
  })

  it('says an unknown stack name is ignored, and suggests the cased name', async () => {
    const { warnings } = await pullWith({ stack: ['react', 'PostgreSQL', 'TypeScript'] })
    expect(warnings).toEqual([
      'warning: profile/search.yaml stack "react" and "PostgreSQL" are not names Remote Rocketship knows, so it ignores them and the search loses that filter; names are case-sensitive, and "react" is written React',
    ])
  })

  it('names a single stack value without a list', async () => {
    const { warnings } = await pullWith({ stack: ['Rust++'] })
    expect(warnings[0]).toContain('stack "Rust++" is not a name')
    expect(warnings[0]).not.toContain('case-sensitive')
  })

  // Guards drift: reads the board notes, outside the fixture, so they keep naming the types the warning takes.
  it('lists every accepted employment type in the board notes', () => {
    const notes = readFileSync(join(import.meta.dirname, '../../docs/boards/rocketship.md'), 'utf8')
    const row = notes.split('\n').find((l) => l.startsWith('| Employment type |')) ?? ''
    for (const type of ROCKETSHIP_EMPLOYMENT) expect(row).toContain(`\`${type}\``)
  })

  it('holds the names the board notes give as examples', () => {
    expect(ROCKETSHIP_COUNTRIES).toEqual(expect.arrayContaining(['Czechia', 'Europe', 'Worldwide']))
    expect(ROCKETSHIP_STACK).toEqual(expect.arrayContaining(['React', 'Postgres', '.NET']))
    expect(ROCKETSHIP_COUNTRIES).not.toContain('EMEA')
    expect(ROCKETSHIP_STACK).not.toContain('PostgreSQL')
  })
})
