// The persona briefs are raw input for live onboarding runs, so each one has to say it is
// fictional; only the non-developer brief is meant to answer every onboarding question.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../lib/workspace.ts'

const dir = join(repoRoot(), 'examples/personas')
const briefs = readdirSync(dir).filter((f) => f.endsWith('.md'))

describe('persona briefs', () => {
  it('finds the shipped briefs', () => {
    expect(briefs).toContain('berlin-frontend.md')
    expect(briefs).toContain('leeds-transport-planner.md')
  })

  it.each(briefs)('%s says it is fictional', (file) => {
    const text = readFileSync(join(dir, file), 'utf8')
    expect(text).toMatch(/^# Persona brief: .*\(fictional\)/)
    expect(text).toContain('Everything here is invented')
  })

  // A run played from this brief must not need anything the brief lacks.
  it('keeps the non-developer brief complete for a live run', () => {
    const text = readFileSync(join(dir, 'leeds-transport-planner.md'), 'utf8')
    for (const heading of [
      '## How she behaves',
      '## Work history',
      '## Pasted CV text',
      '## Wins',
      '## Targets',
      '## Optional sections',
      '## Voice sample',
    ]) {
      expect(text).toContain(heading)
    }
  })
})

// Guards drift: the run's instructions name scripts that must ship beside them.
describe('the live run', () => {
  const dir = join(repoRoot(), 'examples', 'live-run')

  it('holds every file its instructions name', () => {
    const named = [
      ...readFileSync(join(dir, 'README.md'), 'utf8').matchAll(/examples\/live-run\/([\w.-]+)/g),
    ]
    expect(named.length).toBeGreaterThan(0)
    for (const m of named) expect(existsSync(join(dir, m[1] ?? '')), m[0]).toBe(true)
  })

  it('holds every persona brief its instructions name', () => {
    const text = readFileSync(join(dir, 'README.md'), 'utf8')
    const named = [...text.matchAll(/examples\/personas\/([\w.-]+)/g)]
    expect(named.length).toBeGreaterThan(0)
    for (const m of named) expect(briefs, m[0]).toContain(m[1])
  })
})
