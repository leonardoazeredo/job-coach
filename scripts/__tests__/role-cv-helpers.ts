import { afterEach, beforeEach } from 'vitest'
import { buildCv } from '../lib/cv-build.ts'
import type { BulletsFile } from '../lib/cv-schema.ts'
import type { Problem } from '../lib/problem.ts'
import { loadProfile } from '../lib/profile.ts'
import { readCvFile } from '../lib/role-folder.ts'
import { SLUG, variant } from './fixtures.ts'
import { type TempRepo, tempRepo, type WorkedExample } from './temp-repo.ts'

// The hooks register in whichever test file imports this module, so every file
// gets a fresh worked example without repeating the setup.
export let repo: TempRepo
export let larkspur: WorkedExample
beforeEach(() => {
  repo = tempRepo()
  larkspur = repo.workedExample()
})
afterEach(() => repo.dispose())

export const messages = (problems: Problem[], level: Problem['level']) =>
  problems.filter((p) => p.level === level).map((p) => p.message)
export const roleProblems = () => repo.workspace().lintCvs(SLUG).problems
export const writeBullets = (v: BulletsFile) => larkspur.writeYaml('cv/bullets.yaml', v)
export const errorsFor = (v: BulletsFile): string[] => {
  writeBullets(v)
  return messages(roleProblems(), 'error')
}
export const warningsFor = (v: BulletsFile): string[] => {
  writeBullets(v)
  return messages(roleProblems(), 'warning')
}
export const built = () => {
  const ws = repo.workspace()
  const { profile } = loadProfile(repo.path(''), ws.identity())
  const bullets = readCvFile(repo.path(''), SLUG, 'bullets').data
  if (!profile || !bullets) throw new Error('nothing built')
  return buildCv(bullets, profile.master, profile.sources.history())
}
export const masterTech = (id: string): string[] | undefined => {
  const master = JSON.parse(repo.read('cv/master.json'))
  return master.work.find((job: { id: string }) => job.id === id)?.tech
}

// Replaces a job's bullets in the worked example with one bullet.
export const withBullet = (jobId: string, text: string, sourceRefs: string[]): BulletsFile => {
  const v = variant()
  const job = v.jobs.find((j) => j.id === jobId)
  if (!job) throw new Error(`no job ${jobId}`)
  job.bullets = [{ text, sources: sourceRefs, answers: [] }]
  return v
}

// Edits cv/master.json in place; the fixture master has no training or education.
export const editMaster = (edit: (master: Record<string, unknown>) => void) => {
  const master = JSON.parse(repo.read('cv/master.json'))
  edit(master)
  repo.write('cv/master.json', `${JSON.stringify(master, null, 2)}\n`)
}
export const degree = (text: string) => ({
  id: 'edu-1',
  degree: text,
  institution: 'University of Somewhere',
  start: '2010',
  end: '2014',
})
