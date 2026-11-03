// The persona briefs are raw input for live onboarding runs, so each one has to say it is
// fictional; only the non-developer brief is meant to answer every onboarding question.
import { readdirSync, readFileSync } from 'node:fs'
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
