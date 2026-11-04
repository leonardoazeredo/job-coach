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
      '  Metric: CI time on the main service down from 38 minutes to 12 (was CI time on the main service down from 38 minutes to 11)',
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
      'Changed in Tools: Postman, written "Postman (API testing)" except at brightwell\n',
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

  it('drops the comment from a file that still has it on its next write, without calling that a change', async () => {
    const file = 'profile/lessons.md'
    repo.write(file, `${commentOf('lessons')}# Lessons\n\n- one\n`)
    expect((await draft(file, '# Lessons\n\n- one\n')).stdout).toBe('No change.\n')
    expect((await draft(file, '# Lessons\n\n- one\n- two\n')).stdout).toBe('Added: - two\n')
    await write(file)
    expect(repo.read(file)).toBe('# Lessons\n\n- one\n- two\n')
  })
})

describe('profile draft of every data file anew', () => {
  // What the persona does not have is left out on purpose: some standard answers, the
  // education, and a note on the jobs that had none.
  const leftOut = (file: string, values: Obj): Obj => {
    if (file === 'profile/standard-answers.yaml')
      return { ...values, work_authorization: null, career_gaps: null }
    if (file !== 'cv/master.json') return values
    const jobs: unknown[] = Array.isArray(values.work) ? values.work : []
    const work = jobs.map((job) => ({ note: null, ...(job ?? {}) }))
    return { ...values, work, education: null }
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
