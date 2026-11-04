// The templates onboarding copies must not drift from the schemas the scripts read. Those with a
// schema are checked against it, and identity, search and stack also against the example
// persona's keys; each Draft table must name exactly its template's keys; then every template,
// placeholders filled, is loaded as a profile and has to pass the record check.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { ZodType } from 'zod'
import { CvDataSchema, HistoryFileSchema, WinsFileSchema } from '../lib/cv-schema.ts'
import type { Field, Shape } from '../lib/draft-fields.ts'
import { TABLES } from '../lib/draft-table.ts'
import { IdentitySchema } from '../lib/identity.ts'
import { PLACEHOLDER } from '../lib/onboarding.ts'
import { SearchSchema } from '../lib/schema.ts'
import { StackFileSchema } from '../lib/stack.ts'
import { repoRoot } from '../lib/workspace.ts'
import { PERSONA, type TempRepo, tempRepo } from './temp-repo.ts'
import { errors } from './workspace-repo.ts'

// The shipped templates are the thing being guarded, so they are read from the engine, not a copy.
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
  'profile/glossary.example.md': 'profile/glossary.md',
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
  // The level goes to a job board search, so an unanswered one must not pass for a real one.
  'profile/search.example.yaml': ['seniority:'],
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

  it('cv/master.example.json carries the marker in its sample dates, and holds no note', () => {
    const work = JSON.parse(text(join(TEMPLATES, 'cv/master.example.json'))).work[0]
    for (const key of ['start', 'end']) expect(work[key]).toContain(PLACEHOLDER)
    expect(work).not.toHaveProperty('note')
  })

  // A private note is written only for a job that has something private to say, so the template
  // lists no example text a draft could carry into a user's file.
  it('profile/history-private.example.yaml holds only the job id of its example job', () => {
    const job = parse(text(join(TEMPLATES, 'profile/history-private.example.yaml'))).roles[0]
    expect(Object.keys(job)).toEqual(['id'])
  })

  it('the search template presets no seniority level', () => {
    const { seniority } = parse(text(join(TEMPLATES, 'profile/search.example.yaml'))).discovery
      .search
    expect(seniority).toHaveLength(1)
    expect(seniority[0]).toMatch(new RegExp(`^${PLACEHOLDER}`))
  })

  it('cv/master.example.json lets an education entry start be marked for removal', () => {
    const edu = JSON.parse(text(join(TEMPLATES, 'cv/master.example.json'))).education[0]
    expect(edu.start).toContain(PLACEHOLDER)
  })

  // Logs and vocabulary start empty of values the user must replace, so onboarding never lists them.
  it.each(Object.keys(targets))('%s carries the placeholder marker unless it is a log', (name) => {
    expect(text(join(TEMPLATES, name)).includes(PLACEHOLDER)).toBe(!/lessons|glossary/.test(name))
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
  ] as const)('%s has every key the example persona has', (name) => {
    const persona = parse(text(join(PERSONA, targets[name])))
    const template = parse(text(join(TEMPLATES, name)))
    const shape = (v: Record<string, unknown>) =>
      Object.entries(v).flatMap(([k, inner]) =>
        inner && typeof inner === 'object' && !Array.isArray(inner)
          ? [k, ...Object.keys(inner).map((i) => `${k}.${i}`)]
          : [k],
      )
    const have = new Set(shape(template))
    // Tiers and the right-to-work countries are keyed by the person's own choices, and the
    // pack is left unset in the template so the pack step of onboarding must set it.
    const missing = shape(persona).filter(
      (k) => !have.has(k) && k !== 'competency_pack' && !/^(tiers|right_to_work)\./.test(k),
    )
    expect(missing).toEqual([])
  })
})

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// Each named place where the Draft table and its template disagree. The keys of an entries map
// are the user's own, so only the shape of their values is compared.
const drift = (shape: Shape, tpl: unknown, at: string): string[] => {
  const t = isObj(tpl) ? tpl : {}
  const out = Object.keys(t)
    .filter((k) => !(k in shape))
    .map((k) => `${at}${k} is in the template but not the table`)
  for (const [k, f] of Object.entries(shape)) {
    if (f.later) {
      if (k in t) out.push(`${at}${k} is marked later but the template has it`)
      continue
    }
    if (!(k in t)) {
      out.push(`${at}${k} is in the table but not the template`)
      continue
    }
    out.push(...inner(f, t[k], `${at}${k}`))
  }
  return out
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// The shape of the items or entry values a field holds, where the table gives one.
const fieldsOf = (f: Field): Shape | undefined => {
  switch (f.t) {
    case 'items':
      return f.fields
    case 'list':
      return f.item?.fields
    case 'entries':
      return f.value
    default:
      return undefined
  }
}

const inner = (f: Field, v: unknown, at: string): string[] => {
  const marked = JSON.stringify(v).includes(PLACEHOLDER)
  // A default stands unless given, so a placeholder there would be written as if answered.
  const leaf =
    f.t !== 'group' && f.kind === 'default' && marked
      ? [`${at} is a default but holds ${PLACEHOLDER}`]
      : []
  if (f.t === 'group') return drift(f.fields, v, `${at}.`)
  const fields = fieldsOf(f)
  if (!fields) return leaf
  const values = isObj(v) ? Object.values(v) : arr(v)
  return [...leaf, ...values.filter(isObj).flatMap((item) => drift(fields, item, `${at}[].`))]
}

describe('draft tables', () => {
  it('name a table for every template onboarding copies', () => {
    expect(Object.keys(TABLES).sort()).toEqual(Object.values(targets).sort())
    for (const [name, target] of Object.entries(targets))
      expect(TABLES[target]?.template).toBe(name)
  })

  it.each(Object.entries(TABLES).filter(([, t]) => t.format !== 'text'))(
    '%s holds every key of its template, and no other',
    (_, table) => {
      if (table.format === 'text') return
      const src = text(join(TEMPLATES, table.template))
      const tpl = table.format === 'json' ? JSON.parse(src) : parse(src)
      expect(drift(table.root.fields, tpl, '')).toEqual([])
    },
  )
})

describe('templates, filled in', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = tempRepo()
    // The template names no pack, so the record check loads the frontend pack that older copies
    // fall back to from the engine; the test repo needs the engine's copy.
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
