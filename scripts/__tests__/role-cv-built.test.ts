import { describe, expect, it } from 'vitest'
import { CvDataSchema, type HistoryRole } from '../lib/cv-schema.ts'
import type { Problem } from '../lib/problem.ts'
import { requirements, SLUG, variant } from './fixtures.ts'
import { built, larkspur, masterTech, messages, repo } from './role-cv-helpers.ts'

describe('profile problems', () => {
  it('fails check when history.yaml is not newest first', () => {
    repo.editYaml<{ roles: HistoryRole[] }>('profile/history.yaml', (file) => {
      const [cedarline, brightwell, ...rest] = file.roles
      if (!cedarline || !brightwell) throw new Error('worked example changed')
      file.roles = [cedarline, ...rest.slice(0, 1), brightwell, ...rest.slice(1)]
    })
    expect(messages(repo.workspace().check().problems, 'error')).toEqual([
      'roles are not newest first: "independent" (2020-03) is listed before "brightwell" (2021-02)',
    ])
  })

  it('reports bank-tag and stack-limit problems once when several roles have CVs', () => {
    const copy = repo.addRole('larkspur-copy')
    copy.writeYaml('requirements.yaml', { ...requirements(), role: copy.slug })
    copy.writeYaml('cv/bullets.yaml', { ...variant(), role: copy.slug })
    const bank = 'experience-bank/brightwell.md'
    repo.write(
      bank,
      repo.read(bank).replace('Tags: performance, ownership-delivery', 'Tags: charisma'),
    )
    const stack = 'profile/stack.yaml'
    repo.write(
      stack,
      repo
        .read(stack)
        .replace('roles: [harbor-health], claim_as', 'roles: [harbor-health, acme], claim_as'),
    )
    const profileErrors = (problems: Problem[]) =>
      problems
        .filter((p) => p.slug === 'experience-bank' || p.slug === 'profile/stack.yaml')
        .map((p) => `${p.slug}: ${p.message}`)
    const expected = [
      'profile/stack.yaml: "C# / .NET" limit names role "acme", which is not in profile/history.yaml',
      'experience-bank: bank:brightwell#1: unknown tag "charisma"',
    ]
    const ws = repo.workspace()
    expect(ws.lintCvs().checked).toBe(2)
    expect(profileErrors(ws.check().problems)).toEqual(expected)
    expect(profileErrors(ws.lintCvs().problems)).toEqual(expected)
    expect(profileErrors(ws.lintCvs(SLUG).problems)).toEqual(expected)
    expect(profileErrors(ws.roleCv(SLUG).problems)).toEqual(expected)
  })
})

describe('the built CV', () => {
  it('produces valid CvData with no errors', () => {
    const { cv, errors } = built()
    expect(errors).toEqual([])
    expect(CvDataSchema.safeParse(cv).success).toBe(true)
    expect(cv.education).toEqual([])
  })

  it('takes identity fields from history.yaml, newest first', () => {
    const { cv } = built()
    expect(cv.work.map((j) => j.id)).toEqual(['cedarline-payments', 'brightwell', 'harbor-health'])
    expect(cv.work[0]).toMatchObject({
      role: 'Senior Backend Engineer',
      company: 'Cedarline Payments',
      start: 'November 2023',
      end: 'July 2026',
    })
    expect(cv.work[0]?.note).toBeUndefined()
    larkspur.writeVariant((v) => {
      v.jobs.splice(2, 0, { id: 'independent', bullets: [] })
    })
    expect(built().cv.work[2]).toMatchObject({ id: 'independent', note: 'self-employed' })
  })

  it('turns ISO months into CV dates and keeps anything else as written', () => {
    expect(built().cv.work[1]?.start).toBe('February 2021')
    repo.editYaml<{ roles: HistoryRole[] }>('profile/history.yaml', (file) => {
      const cedarline = file.roles[0]
      if (cedarline) cedarline.public.end = 'Present'
    })
    expect(built().cv.work[0]?.end).toBe('Present')
  })

  it('keeps master tech lists unless the variant overrides them', () => {
    expect(built().cv.work[1]?.tech).toEqual(masterTech('brightwell'))
    larkspur.writeVariant((v) => {
      if (v.jobs[0]) v.jobs[0].tech = ['Python', 'Go']
    })
    expect(built().cv.work[0]?.tech).toEqual(['Python', 'Go'])
  })

  it('reports job ids that are not in history.yaml', () => {
    larkspur.writeVariant((v) => {
      v.jobs.push({ id: 'acme', bullets: [] })
    })
    expect(built().errors).toEqual([expect.stringContaining('"acme"')])
  })

  it('matches master ids that predate history.yaml ids', () => {
    larkspur.writeVariant((v) => {
      v.jobs.splice(2, 0, { id: 'independent', bullets: [] })
    })
    expect(built().cv.work.map((j) => j.tech)).toEqual(
      ['cedarline', 'brightwell', 'independent', 'harborhealth'].map(masterTech),
    )
  })
})
