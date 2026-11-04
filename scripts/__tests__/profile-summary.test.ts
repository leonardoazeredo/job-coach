import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { type Field, group } from '../lib/draft-fields.ts'
import { TABLES } from '../lib/draft-table.ts'
import { draft, drafted, personaFile, repo, run, useProfileRepo } from './profile-repo.ts'

useProfileRepo()

type Obj = Record<string, unknown>
// The summary a coach relays to a user who may never have used a terminal, read as printed.

describe('the summary reads properly as printed', () => {
  const fresh = async (file: string, patch: Obj) => {
    const old = repo.read(file)
    repo.remove(file)
    const shown = await draft(file, { ...parse(old), ...patch })
    repo.write(file, old)
    return shown
  }
  const pay = {
    currency: 'GBP',
    floor: 38000,
    by_level: { mid: { min: 40000, max: 46000 } },
  }

  it('says a yes or no value as a word, and a pay in the currency and locale of the draft', async () => {
    const shown = await fresh('profile/identity.yaml', {
      locale: 'en-GB',
      compensation: pay,
      work_setup: { office_days_ok: 2, remote: false },
    })
    expect(shown.stderr).toBe('')
    expect(shown.stdout).toContain('Open to remote work: no\n')
    expect(shown.stdout).toContain('Lowest base pay: £38,000\n')
    expect(shown.stdout).toContain('- mid: £40,000 to £46,000\n')
    expect(shown.stdout).toContain('Locale: British English\n')
    expect(shown.stdout).not.toMatch(/\b(true|false)\b/)
    const search = await fresh('profile/search.yaml', {})
    expect(search.stdout).toMatch(/^Include hybrid roles: yes$/m)
  })

  it('groups the digits in the locale of the draft, and prints a bare number with no currency', async () => {
    const shown = await fresh('profile/identity.yaml', {
      locale: 'de-DE',
      compensation: { ...pay, currency: 'EUR' },
    })
    expect(shown.stdout).toContain('Lowest base pay: 38.000 €\n')
    const bare = await fresh('profile/identity.yaml', {
      compensation: { ...pay, currency: null },
    })
    expect(bare.stdout).toContain('Lowest base pay: 38,000\n')
  })

  it('shows a changed pay with the currency of the file it is in', async () => {
    const shown = await draft('profile/identity.yaml', { compensation: { floor: 140000 } })
    expect(shown.stdout).toBe('Lowest base pay: $140,000 (was $130,000)\n')
  })

  it('prints no line for an empty value', async () => {
    const shown = await fresh('profile/identity.yaml', { linkedin: '', github: '  ' })
    expect(shown.stdout).not.toContain('LinkedIn')
    expect(shown.stdout).not.toContain('GitHub')
    expect(shown.stdout).toContain('Email: dana.okafor@example.com')
    const cleared = await draft('profile/identity.yaml', { github: '' })
    expect(cleared.stdout).toBe('GitHub: left out (was github.com/dana-okafor-example)\n')
  })

  it('names a job by its title and company, not its id', async () => {
    const shown = await draft('profile/stack.yaml', {
      past: [
        { name: 'SQL Server', roles: ['harbor-health', 'brightwell'], claim_as: 'SQL Server' },
      ],
    })
    expect(shown.stdout).toBe(
      'Changed in Past stack: SQL Server: write it as "SQL Server", except in Software Developer at Harbor Health Network and Backend Engineer at Brightwell Logistics, where it may be written plainly\n',
    )
    expect(shown.stdout).not.toContain('harbor-health')
  })

  it('says how many jobs a limit names when the job history is not there', async () => {
    repo.remove('profile/history.yaml')
    const shown = await draft('profile/stack.yaml', {
      tools: [{ name: 'Postman', roles: ['brightwell'], claim_as: 'Postman (API testing)' }],
    })
    expect(shown.stdout).toBe(
      'Changed in Tools: Postman: write it as "Postman (API testing)", except in one of your jobs, where it may be written plainly\n',
    )
  })

  it('says a limit with no job as always worded the same way', async () => {
    const shown = await draft('profile/stack.yaml', {
      tools: [{ name: 'Postman', roles: [], claim_as: 'Postman (API testing)' }],
    })
    expect(shown.stdout).toBe('Changed in Tools: Postman: write it as "Postman (API testing)"\n')
  })

  it('never prints a pattern, and says the coach checks CV text for the claim', async () => {
    const stack = await fresh('profile/stack.yaml', {})
    const line = stack.stdout.split('\n').find((l) => l.startsWith('- Java and the JVM'))
    expect(line).toBe(
      '- Java and the JVM; say instead: none, treat as a hard gap (the coach checks CV text for this claim)',
    )
    expect(stack.stdout).not.toContain('Patterns')
    expect(stack.stdout).not.toContain('\\b')
    // The schema asks for at least one pattern, so every item carries the addition.
    const items = stack.stdout.split('\n').filter((l) => l.includes('; say instead: '))
    expect(items).toHaveLength(4)
    for (const item of items) expect(item).toMatch(/ \(the coach checks CV text for this claim\)$/)
  })

  it('names the job a private note is about, and a pack by its plain name', async () => {
    const shown = await draft('profile/history-private.yaml', {
      roles: [{ id: 'brightwell', payroll_title: 'Admin Assistant' }],
    })
    expect(shown.stderr).toBe('')
    expect(shown.stdout).toBe(
      'Private notes on jobs:\n- Private notes on Backend Engineer at Brightwell Logistics, payroll title Admin Assistant\n',
    )
    const pack = await draft('profile/identity.yaml', { competency_pack: 'road-freight-planning' })
    expect(pack.stdout).toBe('Competency pack: Road freight planning (was Backend)\n')
  })

  it('uses the label a competency pack file gives itself', async () => {
    repo.write(
      'config/competencies/road-freight-planning.yaml',
      'label: Freight planning\ncompetencies: []\nthemes: []\n',
    )
    const pack = await draft('profile/identity.yaml', { competency_pack: 'road-freight-planning' })
    expect(pack.stdout).toBe('Competency pack: Freight planning (was Backend)\n')
  })

  it("tells a change that touches only the coach's own tags in plain words", async () => {
    const shown = await draft('profile/wins.yaml', {
      wins: [{ slug: 'bw-test-suite', themes: ['quality', 'tooling'] }],
    })
    expect(shown.stdout).toBe(
      "Nothing you said changes. Only the coach's own tags and codes are updated.\n",
    )
  })

  it('does not ask about a job note or a private note that has no answer', async () => {
    const cv = JSON.parse(repo.read('cv/master.json'))
    repo.remove('cv/master.json')
    const shown = await draft('cv/master.json', { ...cv, education: null })
    expect(shown.stderr).toBe('')
    const text = drafted('cv/master.json')
    expect(JSON.parse(text).work.filter((j: Obj) => !('note' in j)).length).toBeGreaterThan(0)
    expect(text).not.toContain('CHANGE_ME')
    const priv = await draft('profile/history-private.yaml', { roles: [{ id: 'harbor-health' }] })
    expect(priv.stderr).toBe('')
    expect(drafted('profile/history-private.yaml')).not.toContain('CHANGE_ME')
  })
})

describe('the summary of an odd or changing value', () => {
  it('keeps a locale that is not a language tag as written', async () => {
    const shown = await draft('profile/identity.yaml', { locale: 'en_GB' })
    expect(shown.stderr).toBe('')
    expect(shown.stdout).toBe('Locale: en_GB (was American English)\n')
  })

  it('names the jobs of a limit that changes, once', async () => {
    await draft('profile/stack.yaml', {
      tools: [{ name: 'Postman', roles: ['brightwell'], claim_as: 'Postman (API testing)' }],
    })
    await run(['write', 'profile/stack.yaml'])
    const shown = await draft('profile/stack.yaml', {
      tools: [{ name: 'Postman', roles: ['harbor-health'] }],
    })
    expect(shown.stdout).toBe(
      'Changed in Tools: Postman: write it as "Postman (API testing)", except in Software Developer at Harbor Health Network, where it may be written plainly\n',
    )
  })

  it('shows the old pay in the old currency', async () => {
    const shown = await draft('profile/identity.yaml', {
      compensation: { currency: 'EUR', floor: 120000 },
    })
    expect(shown.stdout).toBe('Currency: EUR (was USD)\nLowest base pay: €120,000 (was $130,000)\n')
  })

  it('prints no line for a blank entry of a map', async () => {
    const shown = await draft('profile/identity.yaml', { right_to_work: { uk: '' } })
    expect(shown.stdout).toBe('No change.\n')
  })

  it('words a map or list left out entry by entry, never as raw values', async () => {
    const shown = await draft('profile/identity.yaml', {
      right_to_work: null,
      compensation: { by_level: null },
    })
    expect(shown.stderr).toBe('')
    expect(shown.stdout).toContain(
      'Removed from Right to work: us: US citizen, no sponsorship needed',
    )
    expect(shown.stdout).toContain('Removed from Pay range by level: mid: $135,000 to $160,000')
    expect(shown.stdout).not.toMatch(/[{}"]/)
  })

  describe('a limit whose jobs change but read alike', () => {
    const postman = (roles: string[], more: Obj = {}) => ({
      tools: [{ name: 'Postman', roles, claim_as: 'Postman (API testing)', ...more }],
    })
    const limited = async () => {
      await draft('profile/stack.yaml', postman(['brightwell']))
      await run(['write', 'profile/stack.yaml'])
    }
    const said = 'Jobs where it may be written plainly: changed'

    it('says so when there is no job history', async () => {
      await limited()
      repo.remove('profile/history.yaml')
      const shown = await draft('profile/stack.yaml', postman(['harbor-health']))
      expect(shown.stdout).toContain(`\n  ${said}\n`)
      expect(shown.stdout).not.toContain('Nothing you said')
    })

    it('says so when neither id is in the job history', async () => {
      await limited()
      repo.write(
        'profile/stack.yaml',
        repo.read('profile/stack.yaml').replace('brightwell', 'gone-one'),
      )
      const shown = await draft('profile/stack.yaml', postman(['gone-two']))
      expect(shown.stdout).toContain(`\n  ${said}\n`)
    })

    it('says so when two jobs share a title and company', async () => {
      await limited()
      const history = personaFile('profile/history.yaml')
      const twin = { ...history.roles[1], id: 'brightwell-again' }
      repo.write('profile/history.yaml', JSON.stringify({ roles: [...history.roles, twin] }))
      const shown = await draft('profile/stack.yaml', postman(['brightwell-again']))
      expect(shown.stdout).toContain(`\n  ${said}\n`)
    })

    it('says so beside a change of wording', async () => {
      await limited()
      repo.remove('profile/history.yaml')
      const shown = await draft(
        'profile/stack.yaml',
        postman(['harbor-health'], { claim_as: 'Postman (testing)' }),
      )
      expect(shown.stdout).toContain(`  ${said}\n`)
      expect(shown.stdout).toContain('How to write it everywhere else: Postman (testing)')
    })
  })

  it("shows a renamed tier, which is the user's own wording", async () => {
    const shown = await draft('profile/search.yaml', { tiers: { 0: { label: 'Dream' } } })
    expect(shown.stdout).toMatch(/^Tier 0 name: Dream \(was .+\)$/m)
  })

  it('says so when items are only put in another order', async () => {
    const shown = await draft('profile/stack.yaml', {
      core: [{ remove: 'Python (8+ years)' }, 'Python (8+ years)'],
    })
    expect(shown.stdout).toBe('Core stack: order changed\n')
  })

  it('says a win changed job when two jobs read alike', async () => {
    const history = personaFile('profile/history.yaml')
    const twin = { ...history.roles[1], id: 'brightwell-again' }
    repo.write('profile/history.yaml', JSON.stringify({ roles: [...history.roles, twin] }))
    const shown = await draft('profile/wins.yaml', {
      wins: [{ slug: 'bw-test-suite', role: 'brightwell-again' }],
    })
    expect(shown.stdout).toContain('  Job: changed\n')
    expect(shown.stdout).not.toContain('(was Backend Engineer')
  })

  it('says a win changed job when the job history cannot be read', async () => {
    repo.remove('profile/history.yaml')
    const shown = await draft('profile/wins.yaml', {
      wins: [{ slug: 'bw-test-suite', role: 'harbor-health' }],
    })
    expect(shown.stdout).toContain('Job: changed (your job history could not be read)')
  })

  it('does not say "null" for a key the file holds with no value', async () => {
    repo.write(
      'profile/identity.yaml',
      repo.read('profile/identity.yaml').replace(/^github:.*$/m, 'github:'),
    )
    const shown = await draft('profile/identity.yaml', { github: 'github.com/x' })
    expect(shown.stdout).toBe('GitHub: github.com/x\n')
  })

  it('shows the job a win moves to', async () => {
    const shown = await draft('profile/wins.yaml', {
      wins: [{ slug: 'bw-test-suite', role: 'harbor-health' }],
    })
    expect(shown.stdout).toContain(
      'Job: Software Developer at Harbor Health Network (was Backend Engineer at Brightwell Logistics)',
    )
  })
})

describe('the table and the summary agree', () => {
  const members = (v: unknown): [string, unknown][] =>
    v !== null && typeof v === 'object' ? Object.entries(v) : []
  // Each member of an item, entry or list as the string it is, or through the fields it has.
  const each = (v: unknown, inner: Field | undefined): string[] =>
    members(v).flatMap(([, x]) => {
      if (typeof x === 'string') return [x]
      return inner ? said(inner, x) : []
    })
  // The strings a summary must say word for word: every shown value that is not turned into
  // other words (a date, a pay, a job, a yes or no).
  const said = (f: Field, v: unknown): string[] => {
    if (f.t !== 'group' && f.kind === 'exempt') return []
    switch (f.t) {
      case 'group':
        return members(v).flatMap(([k, x]) => (f.fields[k] ? said(f.fields[k], x) : []))
      case 'value':
        return typeof v === 'string' && !f.date && !f.as && !f.standIn ? [v] : []
      case 'entries':
        return each(v, f.value && group(f.value))
      case 'items':
        return each(v, group(f.fields))
      case 'list':
        return f.as ? [] : each(v, f.item && group(f.item.fields))
    }
  }

  it.each([
    'profile/identity.yaml',
    'profile/search.yaml',
    'profile/stack.yaml',
    'profile/history.yaml',
    'profile/wins.yaml',
  ] as const)('%s: every value the table shows is in the summary of a new file', async (file) => {
    const values = personaFile(file)
    repo.remove(file)
    const shown = await draft(file, values)
    const table = TABLES[file]
    if (!table || table.format === 'text') throw new Error('no table')
    expect(said(table.root, values).filter((s) => !shown.stdout.includes(s))).toEqual([])
  })
})
