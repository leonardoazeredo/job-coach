import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cvBuild } from '../cv-build.ts'
import { cvEvidence } from '../cv-evidence.ts'
import { cvLint } from '../cv-lint.ts'
import { exportCv, type PdfPrinter } from '../lib/cv-export.ts'
import { EXIT } from '../lib/problem.ts'
import { type TempRepo, tempRepo, type WorkedExample } from './temp-repo.ts'
import { errors } from './workspace-repo.ts'

// A copy of the persona's pack under the legacy fallback's name: with the identity naming no
// pack, a command that still fell back to it would succeed, so the refusal is what stops it.
const FRONTEND = 'config/competencies/frontend.yaml'

let repo: TempRepo
let larkspur: WorkedExample
beforeEach(() => {
  repo = tempRepo()
  larkspur = repo.workedExample()
  repo.write(FRONTEND, repo.read('config/competencies/backend.yaml'))
})
afterEach(() => repo.dispose())

const namePack = (pack: string | undefined) =>
  repo.editYaml<{ competency_pack?: string }>('profile/identity.yaml', (i) => {
    if (pack === undefined) delete i.competency_pack
    else i.competency_pack = pack
  })

const fakePrinter = () => {
  const state = { calls: 0 }
  const printer: PdfPrinter = {
    unavailable: () => undefined,
    print: async () => {
      state.calls++
      return { ok: true, report: '' }
    },
  }
  return { printer, state }
}

const exportRole = (printer: PdfPrinter) =>
  exportCv({ workspace: repo.workspace(), slug: larkspur.slug, printer })

const NEXT_STEP = /no competency pack is chosen.*competency pack step of onboarding/s
const written = () =>
  ['cv/cv.json', 'cv/keywords.txt', 'cv/verify.txt'].filter((f) => existsSync(larkspur.path(f)))

describe('CV commands on an identity that names no competency pack', () => {
  beforeEach(() => namePack(undefined))

  it('cv-evidence refuses, prints nothing and says what to do next', async () => {
    const run = await repo.run(cvEvidence, larkspur.slug)
    expect(run.code).toBe(EXIT.problems)
    expect(run.stdout).toBe('')
    expect(run.stderr).toMatch(NEXT_STEP)
  })

  it('cv-build refuses and writes no files', async () => {
    const run = await repo.run(cvBuild, larkspur.slug)
    expect(run.code).toBe(EXIT.problems)
    expect(run.stderr).toMatch(NEXT_STEP)
    expect(written()).toEqual([])
  })

  it('cv-lint refuses, for one role and for all', async () => {
    for (const args of [[larkspur.slug], []]) {
      const run = await repo.run(cvLint, ...args)
      expect(run.code).toBe(EXIT.problems)
      expect(run.stderr).toMatch(NEXT_STEP)
    }
  })

  it('cv-export stops before printing and writes no files', async () => {
    const { printer, state } = fakePrinter()
    const outcome = await exportRole(printer)
    expect(outcome.kind).toBe('lint-blocked')
    expect(errors(outcome.problems).join('\n')).toMatch(NEXT_STEP)
    expect(state.calls).toBe(0)
    expect(written()).toEqual([])
  })

  it('the record check still loads the copy and passes', () => {
    expect(errors(repo.workspace().check().problems)).toEqual([])
  })

  it('refuses without naming a pack file the user never chose', async () => {
    repo.remove(FRONTEND)
    const run = await repo.run(cvBuild, larkspur.slug)
    expect(run.stderr).toMatch(NEXT_STEP)
    expect(run.stderr).not.toContain('frontend')
  })
})

describe('CV commands with a pack named', () => {
  it('work with frontend chosen on purpose', async () => {
    namePack('frontend')
    expect((await repo.run(cvEvidence, larkspur.slug)).code).toBe(0)
    expect((await repo.run(cvLint, larkspur.slug)).code).toBe(0)
    expect((await repo.run(cvBuild, larkspur.slug)).code).toBe(0)
    expect(written()).toEqual(['cv/cv.json', 'cv/keywords.txt'])
    const { printer, state } = fakePrinter()
    const outcome = await exportRole(printer)
    expect(outcome.kind).not.toBe('lint-blocked')
    expect(state.calls).toBe(1)
  })
})
