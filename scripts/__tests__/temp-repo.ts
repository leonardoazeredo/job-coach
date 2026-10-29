// The temp repo: a throwaway repo laid out like the real one, copied from the example
// persona in examples/austin-backend (profile, rules, CV, experience bank, templates),
// with no roles until a test adds them. Tests never read the live repo, so editing the
// real profile or rules cannot break them.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { BulletsFile, Requirement, RequirementsFile } from '../lib/cv-schema.ts'
import { isDay } from '../lib/dates.ts'
import type { EngineRules, Record, Rules, Search } from '../lib/schema.ts'
import { type Command, openWorkspace, repoRoot, type Workspace } from '../lib/workspace.ts'
import { record, requirements, SLUG, variant } from './fixtures.ts'

export const PERSONA = join(repoRoot(), 'examples/austin-backend')
const EVENTS_TEMPLATE = join(PERSONA, 'pipeline/_templates/events.md')

// The persona ships roles of its own; a temp repo starts empty, so role folders are
// skipped and only pipeline/_templates comes across.
const isPersonaRole = (src: string) =>
  basename(dirname(src)) === 'pipeline' && basename(src) !== '_templates'

export type Files = {
  path: (rel: string) => string
  read: (rel: string) => string
  write: (rel: string, text: string) => void
  writeYaml: (rel: string, data: unknown) => void
  editYaml: <T>(rel: string, edit: (data: T) => void) => void
  remove: (rel: string) => void
}
// Rooted at pipeline/<slug>.
export type RoleFolder = Files & { slug: string }
// writeVariant and writeRequirements each start from a fresh copy of the worked
// example's file, so edits do not accumulate across calls.
export type WorkedExample = RoleFolder & {
  writeVariant: (edit: (v: BulletsFile) => void) => void
  // r1 is partial and strong, r2 covered and must.
  writeRequirements: (
    edit: (r1: Requirement, r2: Requirement, file: RequirementsFile) => void,
  ) => void
}
export type Row = [date: string, event: string]
export type Run = { code: number; stdout: string; stderr: string }
export type TempRepo = Files & {
  // Fresh each call, because a workspace memoises what it has read.
  workspace: () => Workspace
  addRole: (slug: string, overrides?: Partial<Record>, rows?: Row[]) => RoleFolder
  workedExample: () => WorkedExample
  // The engine defaults in config/rules.yaml, and the personal keys in profile/search.yaml.
  editRules: (edit: (rules: EngineRules) => void) => void
  editSearch: (edit: (search: Search) => void) => void
  // Runs a command in-process on a fresh workspace, with what it printed.
  run: (command: Command, ...args: string[]) => Promise<Run>
  dispose: () => void
}

const files = (base: string): Files => {
  const path = (rel: string) => join(base, rel)
  const read = (rel: string) => readFileSync(path(rel), 'utf8')
  const write = (rel: string, text: string) => {
    mkdirSync(join(path(rel), '..'), { recursive: true })
    writeFileSync(path(rel), text)
  }
  const writeYaml = (rel: string, data: unknown) => write(rel, stringify(data))
  return {
    path,
    read,
    write,
    writeYaml,
    editYaml: <T>(rel: string, edit: (data: T) => void) => {
      const data: T = parse(read(rel))
      edit(data)
      writeYaml(rel, data)
    },
    remove: (rel: string) => rmSync(path(rel), { recursive: true }),
  }
}

// Commands print through console and through process.stdout.write; both are captured
// for the run and restored after it, even when the command throws.
const capture = async (body: () => number | Promise<number>): Promise<Run> => {
  const out: string[] = []
  const err: string[] = []
  const saved = {
    log: console.log,
    error: console.error,
    stdout: process.stdout.write,
    stderr: process.stderr.write,
  }
  const line =
    (sink: string[]) =>
    (...parts: unknown[]) => {
      sink.push(`${parts.map(String).join(' ')}\n`)
    }
  const chunk = (sink: string[]) => (text: string | Uint8Array) => {
    sink.push(typeof text === 'string' ? text : Buffer.from(text).toString('utf8'))
    return true
  }
  console.log = line(out)
  console.error = line(err)
  process.stdout.write = chunk(out) as typeof process.stdout.write
  process.stderr.write = chunk(err) as typeof process.stderr.write
  try {
    const code = await body()
    return { code, stdout: out.join(''), stderr: err.join('') }
  } finally {
    console.log = saved.log
    console.error = saved.error
    process.stdout.write = saved.stdout
    process.stderr.write = saved.stderr
  }
}

// Always the persona's template with its header, so the line numbers the record checker
// reports match a real events.md.
const eventsMd = (rec: Record, rows: Row[]): string =>
  readFileSync(EVENTS_TEMPLATE, 'utf8')
    .replace('<Company>', rec.company)
    .replace('<Job title>', rec.job_title ?? '') +
  rows.map(([date, event]) => `| ${date} |  | ${event} |  | Dana |\n`).join('')

// The rows a role gets when the test passes none. validate.ts wants an Applied row
// whenever dates.applied is a day; the Identified row only keeps the file like a real one.
const rowsFor = (rec: Record): Row[] => {
  const rows: Row[] = []
  if (isDay(rec.dates.identified)) rows.push([rec.dates.identified, 'Identified'])
  if (isDay(rec.dates.applied)) rows.push([rec.dates.applied, 'Applied'])
  return rows
}

export const tempRepo = (): TempRepo => {
  const root = mkdtempSync(join(tmpdir(), 'temp-repo-'))
  cpSync(PERSONA, root, { recursive: true, filter: (src) => !isPersonaRole(src) })
  const repo = files(root)

  const addRole: TempRepo['addRole'] = (slug, overrides = {}, rows) => {
    const rec = record({ slug, ...overrides })
    const folder = { ...files(join(root, 'pipeline', slug)), slug }
    folder.writeYaml('record.yaml', rec)
    folder.write('events.md', eventsMd(rec, rows ?? rowsFor(rec)))
    return folder
  }

  const workedExample = (): WorkedExample => {
    const larkspur = addRole(SLUG, {
      company: 'Larkspur Freight',
      job_title: 'Backend Engineer',
      status: 'Identified',
      dates: { identified: '2026-10-23', applied: null, last_activity: '2026-10-23' },
    })
    larkspur.writeYaml('requirements.yaml', requirements())
    larkspur.writeYaml('cv/bullets.yaml', variant())
    return {
      ...larkspur,
      writeVariant: (edit) => {
        const v = variant()
        edit(v)
        larkspur.writeYaml('cv/bullets.yaml', v)
      },
      writeRequirements: (edit) => {
        const file = requirements()
        const [r1, r2] = file.requirements
        if (!r1 || !r2) throw new Error('worked example changed')
        edit(r1, r2, file)
        larkspur.writeYaml('requirements.yaml', file)
      },
    }
  }

  return {
    ...repo,
    workspace: () => openWorkspace(root, () => 'private'),
    addRole,
    workedExample,
    editRules: (edit) => repo.editYaml<EngineRules>('config/rules.yaml', edit),
    editSearch: (edit) => repo.editYaml<Search>('profile/search.yaml', edit),
    run: (command, ...args) =>
      capture(() =>
        command(
          args,
          openWorkspace(root, () => 'private'),
        ),
      ),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

export const personaRules = (): Rules => {
  const { rules, problems } = openWorkspace(PERSONA).rules()
  if (!rules) throw new Error(problems.map((p) => p.message).join('; '))
  return rules
}
