// The templates onboarding copies must not drift from the schemas the scripts read. Those with a
// schema are checked against it, and identity, search and stack also against the example
// persona's keys; then every template, placeholders filled, is loaded as a profile and has to
// pass the record check.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { ZodType } from 'zod'
import { CvDataSchema, HistoryFileSchema, WinsFileSchema } from '../lib/cv-schema.ts'
import { IdentitySchema } from '../lib/identity.ts'
import { PLACEHOLDER } from '../lib/onboarding.ts'
import { SearchSchema } from '../lib/schema.ts'
import { StackFileSchema } from '../lib/stack.ts'
import { repoRoot } from '../lib/workspace.ts'
import { PERSONA, type TempRepo, tempRepo } from './temp-repo.ts'
import { errors } from './workspace-repo.ts'

const TEMPLATES = join(repoRoot(), 'templates')
const text = (path: string) => readFileSync(path, 'utf8')

// template -> where onboarding writes it
const targets = {
  'profile/identity.example.yaml': 'profile/identity.yaml',
  'profile/search.example.yaml': 'profile/search.yaml',
  'profile/coach.example.md': 'profile/coach.md',
  'profile/stack.example.yaml': 'profile/stack.yaml',
  'profile/history.example.yaml': 'profile/history.yaml',
  'profile/history-private.example.yaml': 'profile/history-private.yaml',
  'profile/wins.example.yaml': 'profile/wins.yaml',
  'profile/voice.example.md': 'profile/voice.md',
  'profile/standard-answers.example.yaml': 'profile/standard-answers.yaml',
  'profile/lessons.example.md': 'profile/lessons.md',
  'cv/master.example.json': 'cv/master.json',
}

// Stands in for the user's answers: the marker goes, the rest of the wording stays.
const filled = (src: string) => src.replaceAll(`${PLACEHOLDER} `, 'x ').replaceAll(PLACEHOLDER, 'x')

const schemas: Record<string, ZodType> = {
  'profile/identity.example.yaml': IdentitySchema,
  'profile/search.example.yaml': SearchSchema,
  'profile/stack.example.yaml': StackFileSchema,
  'profile/history.example.yaml': HistoryFileSchema,
  'profile/wins.example.yaml': WinsFileSchema,
}

// A sample value that is personal yet parses cleanly would pass as done if nothing marked it.
const sampleValues: Record<string, string[]> = {
  'profile/identity.example.yaml': [
    'since:',
    'timezone:',
    'experience_years:',
    'currency:',
    'floor:',
    'mid:',
    'office_days_ok:',
  ],
  'profile/history.example.yaml': ['employment_type:', 'start:', 'end:'],
}

describe('templates', () => {
  it.each(Object.entries(sampleValues))(
    '%s marks every sample value as unfinished',
    (name, keys) => {
      const lines = text(join(TEMPLATES, name)).split('\n')
      for (const key of keys) {
        const line = lines.find((l) => l.trimStart().startsWith(key))
        expect(line, `${key} has a line`).toBeDefined()
        expect(line, key).toContain(PLACEHOLDER)
      }
    },
  )

  it('cv/master.example.json carries the marker in its sample dates and note', () => {
    const work = JSON.parse(text(join(TEMPLATES, 'cv/master.example.json'))).work[0]
    for (const key of ['start', 'end', 'note']) expect(work[key]).toContain(PLACEHOLDER)
  })

  it.each(Object.keys(targets))('%s carries the placeholder marker unless it is a log', (name) => {
    expect(text(join(TEMPLATES, name)).includes(PLACEHOLDER)).toBe(!name.includes('lessons'))
  })

  it.each(Object.entries(schemas))('%s validates against its schema', (name, schema) => {
    const data = parse(text(join(TEMPLATES, name)))
    expect(schema.safeParse(data).success).toBe(true)
  })

  it('cv/master.example.json validates against the CV schema', () => {
    const data = JSON.parse(text(join(TEMPLATES, 'cv/master.example.json')))
    expect(CvDataSchema.safeParse(data).success).toBe(true)
  })

  // Identity, search and stack are read beyond what the schemas require, so a key the persona
  // has and the template lacks is drift; the check goes two levels deep.
  it.each([
    'profile/identity.example.yaml',
    'profile/search.example.yaml',
    'profile/stack.example.yaml',
  ])('%s has every key the example persona has', (name) => {
    const persona = parse(text(join(PERSONA, targets[name as keyof typeof targets])))
    const template = parse(text(join(TEMPLATES, name)))
    const shape = (v: Record<string, unknown>) =>
      Object.entries(v).flatMap(([k, inner]) =>
        inner && typeof inner === 'object' && !Array.isArray(inner)
          ? [k, ...Object.keys(inner).map((i) => `${k}.${i}`)]
          : [k],
      )
    const have = new Set(shape(template))
    // Tiers and the right-to-work countries are keyed by the person's own choices.
    const missing = shape(persona).filter(
      (k) => !have.has(k) && !/^(tiers|right_to_work)\./.test(k),
    )
    expect(missing).toEqual([])
  })
})

describe('templates, filled in', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = tempRepo()
    for (const [name, target] of Object.entries(targets))
      repo.write(target, filled(text(join(TEMPLATES, name))))
    repo.write(
      'config/competencies/frontend.yaml',
      text(join(repoRoot(), 'config/competencies/frontend.yaml')),
    )
  })
  afterEach(() => repo.dispose())

  it('load as a profile that the record check accepts', () => {
    expect(errors(repo.workspace().check().problems)).toEqual([])
    expect(repo.workspace().profile().profile).toBeDefined()
  })

  it('count as unfinished while the marker is still in them', () => {
    for (const [name, target] of Object.entries(targets))
      repo.write(target, text(join(TEMPLATES, name)))
    const left = repo
      .workspace()
      .onboarding()
      .filter((s) => s.placeholders.length > 0)
      .map((s) => s.id)
    expect(left).toEqual(['cv-import', 'identity', 'wins', 'voice', 'sensitive'])
  })
})
