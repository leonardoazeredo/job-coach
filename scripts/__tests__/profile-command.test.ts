import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { EXIT } from '../lib/problem.ts'
import { repoRoot } from '../lib/workspace.ts'
import { draft, drafted, personaFile, repo, run, useProfileRepo, write } from './profile-repo.ts'

useProfileRepo()

type Obj = Record<string, unknown>

describe('profile draft and write', () => {
  it('refuses a new search with no Field terms, and takes none as an empty list', async () => {
    const values = personaFile('profile/search.yaml') as { discovery: Obj }
    repo.remove('profile/search.yaml')
    delete values.discovery.field_terms
    delete values.discovery.excluded_words
    const refused = await run(['draft', 'profile/search.yaml'], values)
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr).toContain('Words in a job title that show it is your kind of work')
    expect(refused.stderr).not.toContain('rule it out')

    values.discovery.field_terms = []
    expect((await run(['draft', 'profile/search.yaml'], values)).code).toBe(0)
    await write('profile/search.yaml')
    const { discovery } = parse(repo.read('profile/search.yaml'))
    expect(discovery.field_terms).toEqual([])
    expect(discovery.excluded_words).toEqual([])
  })

  it('drafts a new history from the values, one line per job, and writes the draft unchanged', async () => {
    const values = personaFile('profile/history.yaml')
    repo.remove('profile/history.yaml')

    const shown = await draft('profile/history.yaml', values)
    expect(shown.stderr).toBe('')
    expect(shown.code).toBe(0)
    const frames = shown.stdout.split('\n').filter((l) => l.startsWith('- '))
    expect(frames).toEqual([
      '- Senior Backend Engineer at Cedarline Payments, November 2023 to July 2026, permanent',
      '- Backend Engineer at Brightwell Logistics, February 2021 to October 2023, permanent',
      '- Contract Python Developer at Self-employed, March 2020 to January 2021, self-employed',
      '- Software Developer at Harbor Health Network, September 2017 to February 2020, permanent',
    ])
    expect(existsSync(repo.path('profile/history.yaml'))).toBe(false)

    const text = drafted('profile/history.yaml')
    const written = await write('profile/history.yaml')
    expect(written.stderr).toBe('')
    expect(written.code).toBe(0)
    expect(repo.read('profile/history.yaml')).toBe(text)
    expect(parse(text)).toEqual(values)
    expect(existsSync(repo.path('.coach/drafts/profile/history.yaml'))).toBe(false)
  })

  it('shows only the changes to an existing file and keeps every item it does not mention', async () => {
    const before = {
      history: personaFile('profile/history.yaml'),
      wins: personaFile('profile/wins.yaml'),
      stack: personaFile('profile/stack.yaml'),
    }
    const job = await draft('profile/history.yaml', {
      roles: [{ id: 'brightwell', public: { title: 'Senior Backend Engineer' } }],
    })
    expect(job.stdout).toBe(
      'Changed in Jobs: Senior Backend Engineer at Brightwell Logistics, February 2021 to October 2023, permanent\n' +
        '  Title: Senior Backend Engineer (was Backend Engineer)\n',
    )
    const win = await draft('profile/wins.yaml', {
      wins: [
        { slug: 'bw-test-suite', metric: 'CI time on the main service down from 38 minutes to 12' },
      ],
    })
    expect(win.stdout).toContain(
      '  Figure: CI time on the main service down from 38 minutes to 12 (was CI time on the main service down from 38 minutes to 11)',
    )
    expect(win.stdout.split('\n').filter((l) => l.startsWith('Changed'))).toHaveLength(1)
    const tool = await draft('profile/stack.yaml', { tools: ['Make'] })
    expect(tool.stdout).toBe('Added to Tools: Make\n')

    const written = await write('profile/history.yaml', 'profile/wins.yaml', 'profile/stack.yaml')
    expect(written.stderr).toBe('')
    const roles = personaFile('profile/history.yaml').roles
    const others = (list: { id: string }[]) => list.filter((r) => r.id !== 'brightwell')
    expect(others(roles)).toEqual(others(before.history.roles))
    expect(roles.find((r: { id: string }) => r.id === 'brightwell').public.title).toBe(
      'Senior Backend Engineer',
    )
    const otherWins = (list: { slug: string }[]) => list.filter((w) => w.slug !== 'bw-test-suite')
    expect(otherWins(personaFile('profile/wins.yaml').wins)).toEqual(otherWins(before.wins.wins))
    const stack = personaFile('profile/stack.yaml')
    expect(stack).toEqual({ ...before.stack, tools: [...before.stack.tools, 'Make'] })
  })

  it('says a win with no number as "no number yet" while the file keeps Not specified', async () => {
    const action = 'Rebuilt the payment retry queue'
    const added = await draft('profile/wins.yaml', {
      wins: [
        {
          slug: 'retry-queue',
          role: 'cedarline-payments',
          themes: ['reliability'],
          action,
          metric: 'Not specified',
        },
      ],
    })
    expect(added.stderr).toBe('')
    expect(added.stdout).toBe(
      `Added to Achievements: ${action}\n  Job: Senior Backend Engineer at Cedarline Payments\n  Approval: waiting for your yes\n  Figure: no number yet\n`,
    )
    await write('profile/wins.yaml')
    const saved = personaFile('profile/wins.yaml').wins.find(
      (w: { slug: string }) => w.slug === 'retry-queue',
    )
    expect(saved.metric).toBe('Not specified')

    const lost = await draft('profile/wins.yaml', {
      wins: [{ slug: 'bw-test-suite', metric: 'Not specified' }],
    })
    expect(lost.stdout).toContain(
      '  Figure: no number yet (was CI time on the main service down from 38 minutes to 11)',
    )

    const found = await draft('profile/wins.yaml', {
      wins: [{ slug: 'retry-queue', metric: 'up to 40%' }],
    })
    expect(found.stdout).toContain('  Figure: up to 40% (was no number yet)')
  })

  it('removes an item only when told to', async () => {
    const shown = await draft('profile/stack.yaml', { tools: [{ remove: 'tmux' }] })
    expect(shown.stdout).toBe('Removed from Tools: tmux\n')
    await write('profile/stack.yaml')
    expect(personaFile('profile/stack.yaml').tools).not.toContain('tmux')
  })
})

describe('profile draft refusals', () => {
  it('summarises a plain stack item turned limited in words, with no raw value', async () => {
    const shown = await draft('profile/stack.yaml', {
      tools: [{ name: 'Postman', roles: ['brightwell'], claim_as: 'Postman (API testing)' }],
    })
    expect(shown.stdout).toBe(
      'Changed in Tools: Postman: write it as "Postman (API testing)", except in Backend Engineer at Brightwell Logistics, where it may be written plainly\n',
    )
  })

  it('refuses a new file that leaves a sample value in place, naming it, and drafts nothing', async () => {
    const values = personaFile('profile/identity.yaml')
    delete values.location.timezone
    repo.remove('profile/identity.yaml')
    const shown = await draft('profile/identity.yaml', values)
    expect(shown.code).toBe(EXIT.problems)
    expect(shown.stdout).toBe('')
    expect(shown.stderr).toBe(
      'error  profile/identity.yaml: "Timezone" still holds the template\'s example; give a value, or null to leave it out\n',
    )
    expect(existsSync(repo.path('.coach/drafts/profile/identity.yaml'))).toBe(false)
    expect((await write('profile/identity.yaml')).code).toBe(EXIT.missing)
    expect(existsSync(repo.path('profile/identity.yaml'))).toBe(false)
  })

  it('refuses a new job that leaves a sample date in place', async () => {
    const shown = await draft('profile/history.yaml', {
      roles: [
        {
          id: 'calder',
          company: 'Calder Haulage',
          public: {
            title: 'Planner',
            employment_type: 'permanent',
            end: 'present',
            location: null,
          },
          summary: 'Planning.',
        },
      ],
    })
    expect(shown.code).toBe(EXIT.problems)
    expect(shown.stderr).toContain('"Start" (calder in Jobs) still holds')
  })

  it('refuses a date that is not a real month or day, naming the field and the value as written', async () => {
    const month = await draft('profile/identity.yaml', { location: { since: '2021-13' } })
    expect(month.code).toBe(EXIT.problems)
    expect(month.stdout).toBe('')
    expect(month.stderr).toContain('"Living there since" is not a real date: 2021-13')
    const day = await draft('profile/identity.yaml', { location: { since: '2024-02-31' } })
    expect(day.code).toBe(EXIT.problems)
    expect(day.stdout).toBe('')
    expect(day.stderr).toContain('"Living there since" is not a real date: 2024-02-31')
    expect(existsSync(repo.path('.coach/drafts/profile/identity.yaml'))).toBe(false)
    const job = await draft('profile/history.yaml', {
      roles: [{ id: 'brightwell', public: { start: '2024-00' } }],
    })
    expect(job.code).toBe(EXIT.problems)
    expect(job.stderr).toContain('"Start" (brightwell in Jobs) is not a real date: 2024-00')
  })

  it('still takes a real day, a month, a year, present and null as dates', async () => {
    for (const since of ['2024-02-29', '2021-12', '2021', 'present', null]) {
      const shown = await draft('profile/identity.yaml', { location: { since } })
      expect(shown.code, String(since)).not.toBe(EXIT.problems)
    }
  })

  it('takes null as leaving a sample out on purpose', async () => {
    const values = personaFile('profile/identity.yaml')
    values.location.since = null
    repo.remove('profile/identity.yaml')
    const shown = await draft('profile/identity.yaml', values)
    expect(shown.stderr).toBe('')
    expect(shown.stdout).not.toContain('Living there since')
    expect(shown.stdout).toContain('Timezone: America/Chicago')
  })
})

describe('profile write refusals', () => {
  it('refuses to write a draft whose file changed after the draft was made', async () => {
    await draft('profile/stack.yaml', { tools: ['Make'] })
    const edited = `${repo.read('profile/stack.yaml')}# a note of her own\n`
    repo.write('profile/stack.yaml', edited)
    const written = await write('profile/stack.yaml')
    expect(written.code).toBe(EXIT.problems)
    expect(written.stderr).toContain('profile/stack.yaml: changed after its draft was made')
    expect(repo.read('profile/stack.yaml')).toBe(edited)
  })

  it('puts the file back when the record check fails after the write', async () => {
    const old = repo.read('profile/history.yaml')
    await draft('profile/history.yaml', { roles: [{ remove: 'harbor-health' }] })
    const written = await write('profile/history.yaml')
    expect(written.code).toBe(EXIT.problems)
    expect(written.stdout).toContain('not written')
    expect(written.stderr).toContain('limit names role "harbor-health"')
    expect(repo.read('profile/history.yaml')).toBe(old)
  })

  it('writes no comment into a new file and keeps the comments of an existing one', async () => {
    const values = personaFile('profile/identity.yaml')
    repo.remove('profile/identity.yaml')
    await draft('profile/identity.yaml', values)
    await write('profile/identity.yaml')
    expect(repo.read('profile/identity.yaml')).not.toContain('#')

    const comments = (text: string) =>
      text.split('\n').flatMap((l) => {
        const at = l.indexOf('#')
        return at === -1 ? [] : [l.slice(at).trim()]
      })
    const own = comments(repo.read('profile/search.yaml'))
    expect(own.length).toBeGreaterThan(0)
    await draft('profile/search.yaml', { fit: { min_stack_overlap_pct: 75 } })
    await write('profile/search.yaml')
    expect(comments(repo.read('profile/search.yaml'))).toEqual(own)
  })
})

describe('profile draft with a seniority only one board ignores', () => {
  // The search is shared by every board and the board is named only at pull time, so the
  // schema must not refuse a level that one board does not know.
  it('drafts and checks a search whose seniority Remote Rocketship would ignore', async () => {
    const shown = await draft('profile/search.yaml', {
      discovery: { search: { seniority: ['lead'] } },
    })
    expect(shown.stderr).toBe('')
    expect(shown.code).toBe(0)
    expect(shown.stdout).toContain('Lead')
    await write('profile/search.yaml')
    expect(repo.workspace().check().problems).toEqual([])
  })
})

describe('profile drafts, drop and the other kinds of input', () => {
  it('says so and keeps no draft when nothing would change', async () => {
    const shown = await draft('profile/stack.yaml', { tools: ['Postman'] })
    expect(shown.stdout).toBe('No change.\n')
    expect((await run(['drafts'])).stdout).toBe('No drafts are waiting.\n')
  })

  it('lists and drops the drafts waiting', async () => {
    await draft('profile/stack.yaml', { tools: ['Make'] })
    expect((await run(['drafts'])).stdout).toBe('profile/stack.yaml, made just now\n')
    expect((await run(['drop', 'profile/stack.yaml'])).code).toBe(0)
    expect((await run(['drafts'])).stdout).toBe('No drafts are waiting.\n')
  })

  it('takes the whole text of a markdown file and shows the changed lines', async () => {
    const coach = repo.read('profile/coach.md')
    const next = coach.replace('No hype, no exclamation marks.', 'No hype.')
    const shown = await draft('profile/coach.md', next)
    expect(shown.stdout).toBe(
      'Removed: - Tone: calm, direct and organised. No hype, no exclamation marks.\n' +
        'Added: - Tone: calm, direct and organised. No hype.\n',
    )
    await write('profile/coach.md')
    expect(repo.read('profile/coach.md')).toBe(next)
  })

  it('refuses an input that is not JSON values, and a file no draft is made of', async () => {
    expect((await draft('profile/stack.yaml', 'core: [Go]')).code).toBe(EXIT.data)
    expect((await draft('pipeline/x/record.yaml', {})).code).toBe(EXIT.usage)
    const unknown = await draft('profile/stack.yaml', { colour: 'blue' })
    expect(unknown.stderr).toContain('there is no place for "colour"')
  })
})

describe("a markdown template's own comment", () => {
  const FILES = ['coach', 'voice', 'lessons', 'glossary']
  // Reads the shipped templates because the Draft module strips their real comments, so a
  // copy in the test could drift from them.
  const templateOf = (name: string) =>
    readFileSync(join(repoRoot(), 'templates', 'profile', `${name}.example.md`), 'utf8')
  const commentOf = (name: string) => templateOf(name).match(/^<!--[\s\S]*?-->\n/)?.[0] ?? ''
  const bodyOf = (name: string) => templateOf(name).slice(commentOf(name).length)

  it.each(FILES)('is left out of the %s summary and the saved file', async (name) => {
    const file = `profile/${name}.md`
    if (existsSync(repo.path(file))) repo.remove(file)
    // The person fills the placeholders in the body; the comment arrives as the template has it.
    const filled = `${commentOf(name)}${bodyOf(name).replaceAll('CHANGE_ME', 'Sam')}`
    const shown = await draft(file, filled)
    expect(shown.stderr).toBe('')
    expect(shown.stdout).not.toContain('<!--')
    expect(shown.stdout).not.toContain('Template for')
    await write(file)
    expect(repo.read(file)).toBe(bodyOf(name).replaceAll('CHANGE_ME', 'Sam'))
  })

  it('keeps a comment the user wrote, in the summary and the file', async () => {
    const mine = '<!-- my own note -->\n# Lessons\n'
    const shown = await draft('profile/lessons.md', mine)
    expect(shown.stdout).toContain('<!-- my own note -->')
    await write('profile/lessons.md')
    expect(repo.read('profile/lessons.md')).toBe(mine)
  })

  it('drops the comment from a file that still has it, without listing it as a change', async () => {
    const file = 'profile/lessons.md'
    repo.write(file, `${commentOf('lessons')}# Lessons\n\n- one\n`)
    expect((await draft(file, '# Lessons\n\n- one\n- two\n')).stdout).toBe('Added: - two\n')
    await write(file)
    expect(repo.read(file)).toBe('# Lessons\n\n- one\n- two\n')
  })

  it('drops the comment from a file that differs by nothing else, so a placeholder in it is cleared', async () => {
    const file = 'profile/coach.md'
    repo.write(file, `${commentOf('coach')}${bodyOf('coach').replaceAll('CHANGE_ME', 'Sam')}`)
    const shown = await draft(file, bodyOf('coach').replaceAll('CHANGE_ME', 'Sam'))
    expect(shown.stdout).not.toContain('<!--')
    expect(shown.stdout).not.toBe('No change.\n')
    await write(file)
    expect(repo.read(file)).not.toContain('<!--')
  })

  it.each(FILES)('is recognised in %s when the coach altered it', async (name) => {
    const file = `profile/${name}.md`
    if (existsSync(repo.path(file))) repo.remove(file)
    const altered = commentOf(name)
      .replaceAll('CHANGE_ME', 'Sam')
      .replace(/ [^ ]+ -->/, ' -->')
      .replaceAll('\n', '\r\n')
    const shown = await draft(file, `${altered}${bodyOf(name).replaceAll('CHANGE_ME', 'Sam')}`)
    expect(shown.stdout).not.toContain('<!--')
    await write(file)
    expect(repo.read(file)).not.toContain('<!--')
  })
})

describe('profile draft of every data file anew', () => {
  // What the persona does not have is left out on purpose: some standard answers and the
  // education.
  const leftOut = (file: string, values: Obj): Obj => {
    if (file === 'profile/standard-answers.yaml')
      return { ...values, work_authorization: null, career_gaps: null }
    if (file !== 'cv/master.json') return values
    return { ...values, education: null }
  }
  const files = [
    'profile/identity.yaml',
    'profile/search.yaml',
    'profile/stack.yaml',
    'profile/history.yaml',
    'profile/wins.yaml',
    'profile/standard-answers.yaml',
    'cv/master.json',
  ] as const

  it.each(files)('writes %s back from its values, and the record check passes', async (file) => {
    const text = repo.read(file)
    const values = file.endsWith('.json') ? JSON.parse(text) : parse(text)
    repo.remove(file)
    const shown = await draft(file, leftOut(file, values))
    expect(shown.stderr).toBe('')
    const written = await write(file)
    expect(written.stderr).toBe('')
    const back = file.endsWith('.json') ? JSON.parse(repo.read(file)) : parse(repo.read(file))
    // A new win takes the template's empty lists where the persona leaves them out.
    if (file !== 'profile/wins.yaml') expect(back).toEqual(values)
    expect(
      repo
        .workspace()
        .check()
        .problems.filter((p) => p.level === 'error'),
    ).toEqual([])
  })
})
