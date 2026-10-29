import { basename } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BulletsFile, CvDataSchema, type HistoryRole } from '../lib/cv-schema.ts'
import type { Problem } from '../lib/problem.ts'
import { requirements, SLUG, variant } from './fixtures.ts'
import { type TempRepo, tempRepo, type WorkedExample } from './temp-repo.ts'

let repo: TempRepo
let larkspur: WorkedExample
beforeEach(() => {
  repo = tempRepo()
  larkspur = repo.workedExample()
})
afterEach(() => repo.dispose())

const messages = (problems: Problem[], level: Problem['level']) =>
  problems.filter((p) => p.level === level).map((p) => p.message)
const roleProblems = () => repo.workspace().lintCvs(SLUG).problems
const writeBullets = (v: BulletsFile) => larkspur.writeYaml('cv/bullets.yaml', v)
const errorsFor = (v: BulletsFile): string[] => {
  writeBullets(v)
  return messages(roleProblems(), 'error')
}
const warningsFor = (v: BulletsFile): string[] => {
  writeBullets(v)
  return messages(roleProblems(), 'warning')
}
const built = () => {
  const { build } = repo.workspace().roleCv(SLUG)
  if (!build) throw new Error('nothing built')
  return build
}
const masterTech = (id: string): string[] | undefined => {
  const master = JSON.parse(repo.read('cv/master.json'))
  return master.work.find((job: { id: string }) => job.id === id)?.tech
}

// Replaces a job's bullets in the worked example with one bullet.
const withBullet = (jobId: string, text: string, sourceRefs: string[]): BulletsFile => {
  const v = variant()
  const job = v.jobs.find((j) => j.id === jobId)
  if (!job) throw new Error(`no job ${jobId}`)
  job.bullets = [{ text, sources: sourceRefs, answers: [] }]
  return v
}

describe('line provenance and claims', () => {
  it('passes the worked example', () => {
    expect(errorsFor(variant())).toEqual([])
  })

  it('rejects a ref that does not resolve', () => {
    const v = withBullet('brightwell', 'Built things.', ['win:no-such-win'])
    expect(errorsFor(v)).toEqual([expect.stringContaining('no such win')])
  })

  it('rejects a number that no source holds', () => {
    const v = withBullet('brightwell', 'Mentored 40 interns.', ['win:bw-intern-programme'])
    expect(errorsFor(v)).toEqual([expect.stringContaining('number "40"')])
  })

  it('rejects a metric that is not quoted whole', () => {
    const v = withBullet(
      'brightwell',
      'Moved label printing to Lambda, cutting the monthly bill from $9,400.',
      ['win:bw-aws-cost'],
    )
    expect(errorsFor(v)).toEqual([expect.stringContaining('without its metric quoted whole')])
  })

  it('keeps "contributed to" when the win says it', () => {
    const v = withBullet(
      'cedarline-payments',
      'Wrote the tokenisation client library and moved four services onto it.',
      ['win:cl-pci-scope'],
    )
    expect(errorsFor(v)).toEqual([expect.stringContaining('"contributed to"')])
  })

  it('rejects a verb stronger than the source', () => {
    const v = withBullet('brightwell', 'Led the dock-booking API.', ['win:bw-dock-scheduling'])
    expect(errorsFor(v)).toEqual([expect.stringContaining('"Led" is stronger than its sources')])
  })

  it('accepts a stronger verb Dana confirmed', () => {
    const v = withBullet('brightwell', 'Led the dock-booking API.', ['win:bw-dock-scheduling'])
    const bullet = v.jobs.find((j) => j.id === 'brightwell')?.bullets[0]
    if (bullet) bullet.strength_ok_by = 'user'
    expect(errorsFor(v)).toEqual([])
  })

  it('no longer accepts a confirmation that names a person', () => {
    const v = withBullet('brightwell', 'Led the dock-booking API.', ['win:bw-dock-scheduling'])
    const bullet = v.jobs.find((j) => j.id === 'brightwell')?.bullets[0]
    if (bullet) (bullet as { strength_ok_by?: string }).strength_ok_by = 'someone-else'
    expect(errorsFor(v)).toEqual([expect.stringContaining('strength_ok_by')])
  })

  it('rejects a fact moved to another job', () => {
    const v = withBullet('brightwell', 'Introduced idempotency keys on card captures.', [
      'win:cl-idempotency-keys',
    ])
    expect(errorsFor(v)).toEqual([expect.stringContaining('belongs to cedarline-payments')])
  })

  it('rejects never_say phrases and do_not_claim items', () => {
    const v = withBullet('brightwell', 'Halved cloud spend as a Kubernetes expert.', [
      'win:bw-aws-cost',
    ])
    const errors = errorsFor(v)
    expect(errors).toContainEqual(expect.stringContaining('never_say'))
    expect(errors).toContainEqual(
      expect.stringContaining('do_not_claim "Kubernetes cluster administration"'),
    )
  })

  it('rejects a seniority word she has not held', () => {
    const v = variant()
    v.headline = 'Staff Backend Engineer'
    expect(errorsFor(v)).toEqual([expect.stringContaining('headline uses "Staff"')])
  })

  it('rejects a skill that is not in stack.yaml', () => {
    const v = variant()
    v.skills = ['Python', 'Kubernetes operators']
    expect(errorsFor(v)).toEqual([expect.stringContaining('"Kubernetes operators"')])
  })

  it('holds limited stack items to their limit in skills and job tech lists', () => {
    const v = variant()
    v.skills = ['Python', 'Kubernetes', 'Rust (side projects)']
    const job = (id: string) => v.jobs.find((j) => j.id === id)
    const bw = job('brightwell')
    const hh = job('harbor-health')
    if (!bw || !hh) throw new Error('worked example changed')
    bw.tech = ['Python', 'C# / .NET']
    hh.tech = ['Python', 'C# / .NET']
    expect(errorsFor(v)).toEqual([
      'cv: skills: "Kubernetes" has a limit in profile/stack.yaml; write "Kubernetes (deploy only)"',
      'cv: brightwell: tech "C# / .NET" has a limit in profile/stack.yaml; write "C# / .NET (early career)"',
    ])
  })

  it('warns, without failing, about omitted jobs and tech outside the stack', () => {
    const warnings = warningsFor(variant())
    expect(warnings).toContainEqual(expect.stringContaining('job "independent" is left out'))
    expect(warnings).toContainEqual(expect.stringContaining('tech "Celery"'))
  })
})

// Edits cv/master.json in place; the fixture master has no training or education.
const editMaster = (edit: (master: Record<string, unknown>) => void) => {
  const master = JSON.parse(repo.read('cv/master.json'))
  edit(master)
  repo.write('cv/master.json', `${JSON.stringify(master, null, 2)}\n`)
}
const degree = (text: string) => ({
  id: 'edu-1',
  degree: text,
  institution: 'University of Somewhere',
  start: '2010',
  end: '2014',
})

describe('claims in master-only sections', () => {
  it('rejects a do_not_claim item in training', () => {
    editMaster((m) => {
      m.training = ['Angular course']
    })
    const { problems } = repo.workspace().roleCv(SLUG)
    expect(messages(problems, 'error')).toContainEqual(
      expect.stringContaining('do_not_claim "Frontend framework development"'),
    )
  })

  it('rejects a never_say phrase in languages', () => {
    editMaster((m) => {
      m.languages = ['English (native)', 'halved cloud spend']
    })
    const { problems } = repo.workspace().roleCv(SLUG)
    expect(messages(problems, 'error')).toContainEqual(expect.stringContaining('never_say phrase'))
  })

  it('credits a keyword found only in education, and flags a do_not_claim phrase in it', () => {
    editMaster((m) => {
      m.education = [degree('BSc Zorbology (Angular)')]
    })
    larkspur.writeRequirements((_r1, r2) => {
      r2.keywords = ['Zorbology']
    })
    const rc = repo.workspace().roleCv(SLUG)
    expect(rc.keywords).toEqual(['Zorbology'])
    expect(messages(rc.problems, 'error')).toContainEqual(expect.stringContaining('do_not_claim'))
  })

  it('reports only the build error for a Variant job missing from history', () => {
    larkspur.writeVariant((v) => {
      v.jobs.push({
        id: 'acme',
        bullets: [{ text: 'Did a thing.', sources: ['win:bw-intern-programme'], answers: [] }],
      })
    })
    const { problems } = repo.workspace().roleCv(SLUG)
    expect(messages(problems, 'error')).toEqual([expect.stringContaining('"acme"')])
  })
})

describe('stack limits in master-only text', () => {
  const limitErrors = () =>
    messages(repo.workspace().roleCv(SLUG).problems, 'error').filter((m) =>
      m.includes('has a limit in profile/stack.yaml'),
    )

  it('lets a projects line name an item limited to the independent role', () => {
    editMaster((m) => {
      m.projects = ['SMS reminders with Twilio']
    })
    expect(limitErrors()).toEqual([])
  })

  it('holds a bare item in the default summary to its claim_as', () => {
    editMaster((m) => {
      m.summary = 'Some side projects in Rust.'
    })
    expect(limitErrors()).toEqual([
      'cv: summary: "Rust" has a limit in profile/stack.yaml; write "Rust (side projects)"',
    ])
    editMaster((m) => {
      m.summary = 'Some side projects in Rust (side projects).'
    })
    expect(limitErrors()).toEqual([])
  })

  it('holds a training line to claim_as, as it belongs to no role', () => {
    editMaster((m) => {
      m.training = ['Kubernetes course']
    })
    expect(limitErrors()).toEqual([
      'cv: training: "Kubernetes" has a limit in profile/stack.yaml; write "Kubernetes (deploy only)"',
    ])
    editMaster((m) => {
      m.training = ['Kubernetes (deploy only) course']
    })
    expect(limitErrors()).toEqual([])
  })

  it('names the section when projects mention a limited item outside independent', () => {
    editMaster((m) => {
      m.projects = ['a Kubernetes pipeline']
    })
    expect(limitErrors()).toEqual([
      'cv: projects: "Kubernetes" has a limit in profile/stack.yaml; write "Kubernetes (deploy only)"',
    ])
  })

  it('matches whole words with the same case only', () => {
    editMaster((m) => {
      m.summary = 'A rust-proof stack in JavaScript.'
      m.projects = ['a rust-proof stack in JavaScript']
    })
    expect(limitErrors()).toEqual([])
  })

  it('matches names that carry punctuation where written', () => {
    editMaster((m) => {
      m.training = ['C# / .NET course']
    })
    expect(limitErrors()).toEqual([
      'cv: training: "C# / .NET" has a limit in profile/stack.yaml; write "C# / .NET (early career)"',
    ])
  })

  it('leaves a Variant summary to its provenance check', () => {
    editMaster((m) => {
      m.summary = 'Plain summary.'
    })
    const v = variant()
    v.summary = {
      text: 'Side projects in Rust.',
      sources: ['win:bw-intern-programme'],
      answers: [],
    }
    writeBullets(v)
    expect(limitErrors()).toEqual([])
  })
})

describe('job tech', () => {
  const techProblems = (tech: string) => {
    const v = variant()
    const bw = v.jobs.find((j) => j.id === 'brightwell')
    if (!bw) throw new Error('worked example changed')
    bw.tech = ['Python', tech]
    writeBullets(v)
    return roleProblems().filter((p) => p.message.includes(`tech "${tech}"`))
  }

  it('gives exactly one warning for an item not in the stack', () => {
    expect(techProblems('Vue')).toEqual([
      {
        slug: SLUG,
        level: 'warning',
        message: 'cv: brightwell: tech "Vue" is not in profile/stack.yaml; confirm or drop',
      },
    ])
  })

  it('gives exactly one error for an item that needs its limit', () => {
    expect(techProblems('C# / .NET')).toEqual([
      {
        slug: SLUG,
        level: 'error',
        message:
          'cv: brightwell: tech "C# / .NET" has a limit in profile/stack.yaml; write "C# / .NET (early career)"',
      },
    ])
  })
})

describe('stack claims against the fixture profile', () => {
  const skillErrors = (skill: string) =>
    errorsFor({ ...variant(), skills: [skill] }).filter((m) => m.startsWith('cv: skills:'))

  it.each(['Python', 'Go', 'PostgreSQL', 'REST APIs', 'AWS', 'CI/CD', 'Redis'])(
    'accepts %s',
    (item) => expect(skillErrors(item)).toEqual([]),
  )
  it.each(['Spring Boot', 'Kubernetes operators', 'Vue'])('rejects %s', (item) =>
    expect(skillErrors(item)).toEqual([expect.stringContaining(`"${item}"`)]),
  )
  it('accepts every skill in master.json', () => {
    const master = JSON.parse(repo.read('cv/master.json'))
    expect(built().cv.skills).toEqual(master.skills)
    expect(errorsFor(variant()).filter((m) => m.startsWith('cv: skills:'))).toEqual([])
  })
  it('names only history roles in its limits', () => {
    const { problems } = repo.workspace().check()
    expect(problems.filter((p) => p.slug === 'profile/stack.yaml')).toEqual([])
  })
})

describe('experience-bank tags', () => {
  it('passes the tagged experience bank', () => {
    const { problems } = repo.workspace().check()
    expect(problems.filter((p) => p.slug === 'experience-bank')).toEqual([])
  })
})

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

describe('evidence', () => {
  it('finds the stakeholder stories for a stakeholder requirement', () => {
    const [r1] = repo.workspace().roleCv(SLUG).evidence().evidence
    const refs = r1?.candidates.map((c) => c.ref) ?? []
    expect(refs).toContain('bank:brightwell#4')
    expect(refs).toContain('bank:brightwell#2')
  })

  it('checks technology keywords against the stack', () => {
    larkspur.writeRequirements((_r1, r2) => {
      r2.keywords = ['Python', 'Vue']
    })
    const { evidence } = repo.workspace().roleCv(SLUG).evidence()
    expect(evidence[1]?.stack).toEqual({ matched: ['Python'], missing: ['Vue'] })
  })
})

describe('the PDF name', () => {
  it('derives from the name in profile/identity.yaml', () => {
    const { files } = repo.workspace().roleCv(SLUG)
    expect(basename(files.pdf)).toBe('Dana-Okafor-CV.pdf')
  })

  it('follows a change of name', () => {
    repo.editYaml<{ name: string }>('profile/identity.yaml', (i) => {
      i.name = 'Mira Hollweg'
    })
    expect(basename(repo.workspace().roleCv(SLUG).files.pdf)).toBe('Mira-Hollweg-CV.pdf')
  })

  it('blocks a write when identity.yaml cannot be read, so no PDF is named after nobody', () => {
    repo.remove('profile/identity.yaml')
    const problems = repo.workspace().roleCv(SLUG).write()
    expect(messages(problems, 'error')).toContain('is missing')
  })
})
