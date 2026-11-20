import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rocketshipBoard } from '../lib/boards/rocketship.ts'
import {
  ROCKETSHIP_COUNTRIES,
  ROCKETSHIP_EMPLOYMENT,
  ROCKETSHIP_SENIORITY,
  ROCKETSHIP_STACK,
  searchNotes,
  unknownIn,
} from '../lib/boards/rocketship-values.ts'
import { oneOf } from '../lib/draft-rules.ts'
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

  // Guards drift: reads the board notes, outside the fixture, so they keep naming the levels the warning takes.
  it('lists every accepted seniority value in the board notes', () => {
    const notes = readFileSync(join(import.meta.dirname, '../../docs/boards/rocketship.md'), 'utf8')
    const row = notes.split('\n').find((l) => l.startsWith('| Seniority |')) ?? ''
    for (const level of ROCKETSHIP_SENIORITY) expect(row).toContain(`\`${level}\``)
  })

  it('holds the names the board notes give as examples', () => {
    expect(ROCKETSHIP_COUNTRIES).toEqual(expect.arrayContaining(['Czechia', 'Europe', 'Worldwide']))
    expect(ROCKETSHIP_STACK).toEqual(expect.arrayContaining(['React', 'Postgres', '.NET']))
    expect(ROCKETSHIP_COUNTRIES).not.toContain('EMEA')
    expect(ROCKETSHIP_STACK).not.toContain('PostgreSQL')
  })

  it('warns in the order seniority, country, employment, stack', async () => {
    const { warnings } = await pullWith({
      seniority: ['mid', 'Senior', 'lead'],
      country: 'germany',
      employment: 'Full-Time',
      stack: ['typescript', 'Routewise', 'React', 'react'],
    })
    expect(warnings).toEqual([
      'warning: profile/search.yaml seniority "mid", "Senior" and "lead" are not levels Remote Rocketship knows, so it ignores them and the search loses that filter; it takes entry-level, junior, mid-level, senior, expert',
      'warning: profile/search.yaml country "germany" is not a place Remote Rocketship knows, so the search falls back to worldwide-remote roles only; the names are in its location filter, for example United Kingdom, Germany, Czechia',
      'warning: profile/search.yaml employment "Full-Time" is not a type Remote Rocketship knows, so it answers every title with nothing; it takes full-time, part-time, contract, internship',
      'warning: profile/search.yaml stack "typescript", "Routewise" and "react" are not names Remote Rocketship knows, so it ignores them and the search loses that filter; names are case-sensitive, and "typescript" is written TypeScript, "react" is written React',
    ])
  })

  it('has the Draft and the pull flag the same unknown values for the same search', async () => {
    const unknown = {
      seniority: ['mid', 'senior'],
      country: 'Narnia',
      employment: 'permanent',
      stack: ['typescript', 'Routewise', 'React'],
    }
    const { warnings } = await pullWith(unknown)
    const notes = searchNotes({ country: unknown.country, stack: unknown.stack }, undefined)
    const quoted = (v: string) => `"${v}"`
    const flagged = (name: string) => warnings.find((w) => w.includes(` ${name} `)) ?? ''

    // Notes cover country and stack; the Draft refuses the other two with the same lists.
    expect(notes.filter((n) => n.includes('Narnia'))).toHaveLength(1)
    expect(flagged('country')).toContain(quoted('Narnia'))
    for (const v of ['typescript', 'Routewise']) {
      expect(notes.filter((n) => n.includes(` ${v},`))).toHaveLength(1)
      expect(flagged('stack')).toContain(quoted(v))
    }
    expect(notes.join(' ')).not.toContain(' React,')
    expect(flagged('stack')).not.toContain(quoted('React'))
    expect(oneOf(ROCKETSHIP_SENIORITY).holds('mid')).toBe(false)
    expect(flagged('seniority')).toContain(quoted('mid'))
    expect(oneOf(ROCKETSHIP_SENIORITY).holds('senior')).toBe(true)
    expect(flagged('seniority')).not.toContain(quoted('senior'))
    expect(oneOf(ROCKETSHIP_EMPLOYMENT).holds('permanent')).toBe(false)
    expect(flagged('employment')).toContain(quoted('permanent'))
  })
})

describe('unknownIn', () => {
  it('flags an unknown value in each field', () => {
    expect(
      unknownIn({
        seniority: ['junior', 'lead'],
        country: 'Narnia',
        employment: 'permanent',
        stack: ['Routewise'],
      }),
    ).toEqual([
      { field: 'seniority', value: 'lead' },
      { field: 'country', value: 'Narnia' },
      { field: 'employment', value: 'permanent' },
      { field: 'stack', value: 'Routewise', rightCase: undefined },
    ])
  })

  it('stays quiet for known values', () => {
    expect(
      unknownIn({
        seniority: ['junior', 'expert'],
        country: 'Germany',
        employment: 'contract',
        stack: ['React'],
      }),
    ).toEqual([])
  })

  it('gives the right case for a stack name only', () => {
    const [stack] = unknownIn({ stack: ['typescript'] })
    expect(stack?.rightCase).toBe('TypeScript')
    expect(unknownIn({ country: 'germany' })).toEqual([{ field: 'country', value: 'germany' }])
    expect(unknownIn({ employment: 'Full-Time' })).toEqual([
      { field: 'employment', value: 'Full-Time' },
    ])
    expect(unknownIn({ seniority: ['Senior'] })).toEqual([{ field: 'seniority', value: 'Senior' }])
  })

  it('skips a blank country and a field it is not given', () => {
    expect(unknownIn({ country: '' })).toEqual([])
    expect(unknownIn({})).toEqual([])
  })

  it('still flags a blank employment', () => {
    expect(unknownIn({ employment: '' })).toEqual([{ field: 'employment', value: '' }])
  })

  it('leaves out a stack name the draft already had', () => {
    expect(
      searchNotes(
        { country: 'Narnia', stack: ['Routewise', 'Elixirr'] },
        { country: 'Germany', stack: ['Routewise'] },
      ),
    ).toEqual([
      "One job site doesn't know Narnia, so it will show worldwide-remote roles only.",
      "One job site doesn't know Elixirr, so it won't search by it.",
    ])
  })
})

// Every module specifier the file imports, however the import is laid out.
const importsOf = (path: string): string[] =>
  [...readFileSync(join(import.meta.dirname, path), 'utf8').matchAll(/\bfrom\s+'([^']+)'/g)].map(
    (m) => m[1] ?? '',
  )

describe('the import direction', () => {
  it('has the Draft table import the values module and not the board adapter', () => {
    const imports = importsOf('../lib/draft-table.ts')
    expect(imports).toContain('./boards/rocketship-values.ts')
    expect(imports).not.toContain('./boards/rocketship.ts')
  })

  it('has the values module not import the adapter', () => {
    expect(importsOf('../lib/boards/rocketship-values.ts')).not.toContain('./rocketship.ts')
  })
})
