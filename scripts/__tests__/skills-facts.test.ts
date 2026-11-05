import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../lib/workspace.ts'

// Reads the engine's own skills to guard drift against the repo: each test checks a fact the
// repo can answer. Whether the coach follows a skill's words is the live run's question
// (examples/live-run/checklist.md), so no test here pins those words.
const SKILLS = join(repoRoot(), '.claude', 'skills')
const names = readdirSync(SKILLS)
const documents = (name: string) => readdirSync(join(SKILLS, name)).filter((f) => f.endsWith('.md'))
const skill = (name: string) => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
const wholeSkill = (name: string) =>
  documents(name)
    .map((f) => readFileSync(join(SKILLS, name, f), 'utf8'))
    .join('\n')

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
      const text = wholeSkill(name)
      expect(text).not.toMatch(/CHANGE_ME/)
      expect(text).not.toMatch(/strip the template/i)
      expect(text).not.toMatch(/scratch path/i)
    },
  )

  it('names only scripts that exist', () => {
    const named = names.flatMap((name) =>
      [...wholeSkill(name).matchAll(/node (scripts\/[\w/.-]+\.ts)/g)].map((m) => m[1] ?? ''),
    )
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((s) => !existsSync(join(repoRoot(), s)))).toEqual([])
  })

  // A file beside a skill is reached only through a pointer in that skill.
  it.each(names)('%s points at every file beside it', (name) => {
    const beside = documents(name).filter((f) => f !== 'SKILL.md')
    for (const f of beside) expect(skill(name), f).toContain(`.claude/skills/${name}/${f}`)
  })
})

describe('onboarding sends each answer to a place the file has', () => {
  const identity = readFileSync(
    join(repoRoot(), 'templates', 'profile', 'identity.example.yaml'),
    'utf8',
  )
  const rows = skill('onboarding')
    .split('\n')
    .filter((line) => /^\| \d+ \|/.test(line))

  it('asks each numbered item once', () => {
    const numbers = rows.map((row) => Number(row.split('|')[1]))
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
    expect(numbers.length).toBeGreaterThan(0)
  })

  it('names, for the identity items, keys that identity.yaml holds', () => {
    const places = rows
      .map((row) => row.split('|')[3] ?? '')
      .filter((place) => !/\.(yaml|md)/.test(place))
    const keys = places.flatMap((place) =>
      [...place.matchAll(/`([a-z_.]+)`/g)].map((m) => (m[1] ?? '').split('.')[0] ?? ''),
    )
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(identity, k).toMatch(new RegExp(`^${k}:`, 'm'))
  })

  it('keeps pronouns out of the identity template', () => {
    expect(identity).not.toMatch(/pronoun/i)
  })

  it('keeps file names out of the markdown templates the user reads', () => {
    const dir = join(repoRoot(), 'templates', 'profile')
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/`[^`]*\.(yaml|json)`/)
    }
  })
})
