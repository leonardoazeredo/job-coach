// The templates onboarding copies must not drift from the schemas the scripts read. Those with a
// schema are checked against it, and identity, search and stack also against the example
// persona's keys; each Draft table must name exactly its template's keys; then every template,
// placeholders filled, is loaded as a profile and has to pass the record check. The Draft's
// tables are the one list of profile files; the only list kept here is the three the persona check
// names, because those are the files scripts read beyond what their schemas require.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isMap, isNode, isScalar, isSeq, parse, parseDocument } from 'yaml'
import { type Field, groupOf, type Shape } from '../lib/draft-fields.ts'
import { TABLES } from '../lib/draft-table.ts'
import { onboardingStatus } from '../lib/onboarding.ts'
import { PLACEHOLDER } from '../lib/placeholder.ts'
import { loadProfile } from '../lib/profile.ts'
import { repoRoot } from '../lib/workspace.ts'
import { PERSONA, type TempRepo, tempRepo } from './temp-repo.ts'
import { errors } from './workspace-repo.ts'

// The shipped templates are the thing being guarded, so they are read from the engine, not a copy.
const TEMPLATES = join(repoRoot(), 'templates')
const text = (path: string) => readFileSync(path, 'utf8')

const tables = Object.entries(TABLES)
const dataTables = tables.flatMap(([target, t]) =>
  t.format === 'text' ? [] : [[target, t] as const],
)
const parseTemplate = (format: 'yaml' | 'json', src: string) =>
  format === 'json' ? JSON.parse(src) : parse(src)

// Logs and vocabulary start empty of values the user must replace, so onboarding lists no
// section for them and their templates carry no marker.
const LOGS = ['profile/glossary.md', 'profile/lessons.md']

// Stands in for the user's answers: the marker goes, the rest of the wording stays.
const filled = (src: string) => src.replaceAll(`${PLACEHOLDER} `, 'x ').replaceAll(PLACEHOLDER, 'x')

describe('templates', () => {
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

  it.each(tables)(
    '%s carries the placeholder marker unless it is a log',
    (target, { template }) => {
      expect(text(join(TEMPLATES, template)).includes(PLACEHOLDER)).toBe(!LOGS.includes(target))
    },
  )

  it.each(dataTables.flatMap(([, t]) => (t.schema ? [[t.template, t] as const] : [])))(
    '%s validates against its schema',
    (_, table) => {
      const data = parseTemplate(table.format, text(join(TEMPLATES, table.template)))
      expect(table.schema?.safeParse(data).success).toBe(true)
    },
  )

  // Identity, search and stack are read beyond what the schemas require, so a key the persona
  // has and the template lacks is drift; the check goes two levels deep.
  it.each(['profile/identity.yaml', 'profile/search.yaml', 'profile/stack.yaml'])(
    '%s has every key the example persona has',
    (target) => {
      const name = TABLES[target]?.template
      if (name === undefined) throw new Error(`${target} is not a table entry`)
      const persona = parse(text(join(PERSONA, target)))
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
    },
  )
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

const inner = (f: Field, v: unknown, at: string): string[] => {
  const marked = JSON.stringify(v).includes(PLACEHOLDER)
  // A default stands unless given, so a placeholder there would be written as if answered.
  const leaf =
    f.t !== 'group' && f.kind === 'default' && marked
      ? [`${at} is a default but holds ${PLACEHOLDER}`]
      : []
  if (f.t === 'group') return drift(f.fields, v, `${at}.`)
  const fields = groupOf(f)?.fields
  if (!fields) return leaf
  const values = isObj(v) ? Object.values(v) : arr(v)
  return [...leaf, ...values.filter(isObj).flatMap((item) => drift(fields, item, `${at}[].`))]
}

// A value counts as marked when the marker is in it, or on the template line that holds it: an
// inline map such as `mid: {min: 0, max: 0}  # CHANGE_ME ...` is marked as a whole by its line.
type Sample = { key: string; marked: boolean }

// What a container holds, keyed by entry key or list place.
const partsOf = (v: unknown): [string, unknown][] =>
  isObj(v) ? Object.entries(v) : arr(v).map((x, i) => [String(i), x])

const sampleAt = (at: string[], v: unknown, line: (at: string[]) => string): Sample => ({
  key: at.join('.'),
  marked: JSON.stringify(v).includes(PLACEHOLDER) || line(at).includes(PLACEHOLDER),
})

const samplesIn = (shape: Shape, data: unknown, at: string[], line: (at: string[]) => string) => {
  const found: Sample[] = []
  if (!isObj(data)) return found
  for (const [k, f] of Object.entries(shape)) {
    if (f.later || !(k in data)) continue
    const here = [...at, k]
    if (f.t === 'group') {
      found.push(...samplesIn(f.fields, data[k], here, line))
      continue
    }
    // A container with fields is judged by those fields, each on its own line.
    const whole: Field = f
    const fields = groupOf(whole)?.fields
    if (!fields) {
      if (f.kind === 'sample') found.push(sampleAt(here, data[k], line))
      continue
    }
    for (const [id, item] of partsOf(data[k]))
      found.push(...samplesIn(fields, item, [...here, id], line))
  }
  return found
}

// The template line holding the key at a path; a JSON template has no comments, so no line.
const lineOf = (src: string, path: string[]): string => {
  const doc = parseDocument(src)
  const parent = doc.getIn(path.slice(0, -1), true)
  const last = path.at(-1) ?? ''
  let node: unknown
  if (isMap(parent))
    node = parent.items.find((p) => String(isScalar(p.key) ? p.key.value : p.key) === last)?.key
  else if (isSeq(parent)) node = parent.items[Number(last)]
  const at = isNode(node) ? node.range?.[0] : undefined
  if (at === undefined) return ''
  const from = src.lastIndexOf('\n', at - 1) + 1
  const to = src.indexOf('\n', at)
  return src.slice(from, to === -1 ? undefined : to)
}

// Samples whose template carries no marker, each named by file and key. All are tracked in
// #127, which decides what becomes of them; no template or kind changes before then. The check
// below fails when one of them stops being unmarked, so this list cannot outlive that issue.
const UNMARKED_SAMPLES = [
  'profile/identity.yaml locale',
  'profile/identity.yaml work_setup.remote',
  'profile/search.yaml discovery.search.regions',
  'profile/search.yaml discovery.search.employment',
  'profile/search.yaml discovery.search.hybrid',
]

describe('draft tables', () => {
  // Onboarding copies a template to the table's path, so a template no table names would never
  // be written, and one named twice would be written to two places.
  it('name every template under templates/ once, and every template exists', () => {
    const onDisk = readdirSync(TEMPLATES, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(TEMPLATES.length + 1))
    expect(tables.map(([, t]) => t.template).sort()).toEqual(onDisk.sort())
  })

  // A sample is only an example, and one that parses cleanly would pass as done if nothing
  // marked it.
  it('mark every sample value in its template, bar the named exceptions', () => {
    const unmarked = dataTables.flatMap(([target, table]) => {
      const src = text(join(TEMPLATES, table.template))
      const data = parseTemplate(table.format, src)
      const line = (at: string[]) => (table.format === 'json' ? '' : lineOf(src, at))
      return samplesIn(table.root.fields, data, [], line)
        .filter((s) => !s.marked)
        .map((s) => `${target} ${s.key}`)
    })
    expect(unmarked.sort()).toEqual([...UNMARKED_SAMPLES].sort())
  })

  it.each(dataTables)('%s holds every key of its template, and no other', (_, table) => {
    const tpl = parseTemplate(table.format, text(join(TEMPLATES, table.template)))
    expect(drift(table.root.fields, tpl, '')).toEqual([])
  })
})

describe('templates, filled in', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = tempRepo()
    // The template names no pack, so the record check loads the frontend pack that older copies
    // fall back to from the engine; the test repo needs the engine's copy.
    for (const [target, { template }] of tables)
      repo.write(target, filled(text(join(TEMPLATES, template))))
    repo.write(
      'config/competencies/frontend.yaml',
      text(join(repoRoot(), 'config/competencies/frontend.yaml')),
    )
  })
  afterEach(() => repo.dispose())

  it('load as a profile that the record check accepts', () => {
    expect(errors(repo.workspace().check().problems)).toEqual([])
    expect(loadProfile(repo.path(''), repo.workspace().identity()).profile).toBeDefined()
  })

  it('count as unfinished while the marker is still in them', () => {
    for (const [target, { template }] of tables) repo.write(target, text(join(TEMPLATES, template)))
    const left = repo
      .workspace()
      .onboarding()
      .filter((s) => s.placeholders.length > 0)
      .map((s) => s.id)
    expect(left).toEqual(['cv-import', 'identity', 'wins', 'voice', 'sensitive'])
  })
})

describe('template text a person reads in a summary', () => {
  const words = /company-research|\bstack\b/i

  it('names no working step and no stack in a priority or in the target line', () => {
    const { tiers } = parse(text(join(TEMPLATES, 'profile/search.example.yaml')))
    for (const tier of Object.values(tiers) as Record<string, string>[])
      for (const [key, value] of Object.entries(tier)) expect(value, key).not.toMatch(words)
    expect(text(join(TEMPLATES, 'profile/coach.example.md'))).not.toMatch(words)
  })
})

describe('onboarding sections', () => {
  // Nothing exists under a missing root, so every file a section names comes back as missing.
  const sections = onboardingStatus(join(repoRoot(), 'no-such-folder'), 'pack')
  const named = sections.flatMap((s) => (s.id === 'competency-pack' ? [] : s.missing))

  it('name only files the Draft tables know, bar the competency pack, which is no profile file', () => {
    expect(named.filter((f) => !(f in TABLES))).toEqual([])
  })

  // A new profile file is placed in a section or named as a log.
  it('leave out only the logs', () => {
    expect(
      Object.keys(TABLES)
        .filter((f) => !named.includes(f))
        .sort(),
    ).toEqual(LOGS)
  })
})
