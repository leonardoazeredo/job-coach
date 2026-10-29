import { afterEach, beforeEach } from 'vitest'
import type { Win } from '../lib/cv-schema.ts'
import { SLUG } from './fixtures.ts'
import { type RoleFolder, type TempRepo, tempRepo, type WorkedExample } from './temp-repo.ts'

// useWorkspaceRepo() makes these fresh for every test in the file that calls it, so read
// them inside a test or hook: a copy taken while the file loads is undefined.
export let repo: TempRepo
export let larkspur: WorkedExample
export let plain: RoleFolder
export const useWorkspaceRepo = () => {
  beforeEach(() => {
    repo = tempRepo()
    larkspur = repo.workedExample()
    plain = repo.addRole('plain-role', {
      company: 'Larkspur Freight',
      job_title: 'Web Engineer',
      status: 'Identified',
      dates: { identified: '2026-10-23', applied: null, last_activity: '2026-10-23' },
    })
  })
  afterEach(() => repo.dispose())
}

// The summary sits under no job, so a line there is checked without the role-ownership rule.
export const writeBullet = (jobId: string | undefined, text: string, sources: string[]) =>
  larkspur.writeVariant((v) => {
    const line = { text, sources, answers: [] }
    if (jobId === undefined) v.summary = line
    else {
      const job = v.jobs.find((j) => j.id === jobId)
      if (!job) throw new Error(`no job ${jobId}`)
      job.bullets = [line]
    }
  })
export const proposeWin = (slug: string, role: string) =>
  repo.editYaml<{ wins: Win[] }>('profile/wins.yaml', (file) => {
    file.wins.push({
      slug,
      role,
      status: 'proposed',
      themes: ['leadership'],
      competencies: ['stakeholder-management'],
      metric: 'Not specified',
      action: 'Ran stakeholder reviews of the front-end codebase with every team.',
      never_say: [],
    })
  })
type Found = { level: string; slug: string; message: string }[]
export const errors = (problems: Found) =>
  problems.filter((p) => p.level === 'error').map((p) => `${p.slug}: ${p.message}`)
export const warnings = (problems: Found) =>
  problems.filter((p) => p.level === 'warning').map((p) => `${p.slug}: ${p.message}`)
export const lintRole = () => repo.workspace().lintCvs(SLUG).problems
export const requirementWarnings = () =>
  warnings(lintRole()).filter((m) => m.startsWith(`${SLUG}: requirements `))
export const withoutBullets = () => larkspur.remove('cv/bullets.yaml')
