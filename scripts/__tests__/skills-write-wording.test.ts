import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../lib/workspace.ts'

// Reads the engine's own skills: they are the text under test, not a fixture.
const SKILLS = join(repoRoot(), '.claude', 'skills')
const skill = (name: string) => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
const names = readdirSync(SKILLS)

describe('skills write profile files through the Draft command', () => {
  it.each(['onboarding', 'cv-tailor', 'experience-mining', 'interview-debrief', 'take-home'])(
    '%s names the command',
    (name) => {
      expect(skill(name)).toContain('scripts/profile.ts')
    },
  )

  it.each(names)(
    '%s does not tell the coach to copy a template or strip comments by hand',
    (name) => {
      const text = skill(name)
      expect(text).not.toMatch(/CHANGE_ME/)
      expect(text).not.toMatch(/strip the template/i)
      expect(text).not.toMatch(/scratch path/i)
    },
  )

  it('lets the Draft summary escape the rule to summarise tool output', () => {
    const plain = readFileSync(join(repoRoot(), 'CLAUDE.md'), 'utf8')
      .split('## ')
      .find((s) => s.startsWith('Plain words'))
    expect(plain).toContain('relayed whole')
  })

  it('names only scripts that exist', () => {
    const named = names.flatMap((name) =>
      [...skill(name).matchAll(/node (scripts\/[\w/.-]+\.ts)/g)].map((m) => m[1] as string),
    )
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((s) => !existsSync(join(repoRoot(), s)))).toEqual([])
  })
})

describe('onboarding records each answer as given', () => {
  const text = skill('onboarding')
  const identity = readFileSync(
    join(repoRoot(), 'templates', 'profile', 'identity.example.yaml'),
    'utf8',
  )

  it('keeps a preference out of the hard limits', () => {
    expect(text).toMatch(/"I'd rather avoid"[^.]*a preference, not a limit/)
    expect(text).toContain('rules a role out')
  })

  it('sends pronouns to coach.md only and never to identity.yaml', () => {
    expect(text).toMatch(/Pronouns \(2\)[^.]*only into `profile\/coach\.md`/)
    expect(identity).not.toMatch(/pronoun/i)
  })

  it('names, for the identity items, keys that identity.yaml holds', () => {
    const place = text.split('Each answer has one named place.')[1]?.split('\n\n')[0] ?? ''
    const keys = [...place.matchAll(/`([a-z_.]+)`/g)].map((m) => (m[1] as string).split('.')[0])
    for (const k of [
      'name',
      'locale',
      'languages',
      'location',
      'right_to_work',
      'availability',
      'compensation',
      'work_setup',
    ]) {
      expect(keys).toContain(k)
      expect(identity).toMatch(new RegExp(`^${k}:`, 'm'))
    }
  })

  it('never states that the user has no gaps', () => {
    expect(text).toContain('"There are no gaps" is never yours to state')
  })

  it('tells the user what a refusal needs without naming a file', () => {
    expect(text).toContain('never naming a file or a key')
  })
})
