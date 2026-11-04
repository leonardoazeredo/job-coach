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
