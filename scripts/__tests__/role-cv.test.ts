import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SLUG, variant } from './fixtures.ts'
import {
  built,
  errorsFor,
  larkspur,
  messages,
  repo,
  roleProblems,
  warningsFor,
  withBullet,
  writeBullets,
} from './role-cv-helpers.ts'

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
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: deliberately writes a field the type forbids
    if (bullet) (bullet as { strength_ok_by?: string }).strength_ok_by = 'someone-else'
    expect(errorsFor(v)).toEqual([expect.stringContaining('strength_ok_by')])
  })

  it('rejects a fact moved to another job', () => {
    const v = withBullet('brightwell', 'Introduced idempotency keys on card captures.', [
      'win:cl-idempotency-keys',
    ])
    expect(errorsFor(v)).toEqual([expect.stringContaining('belongs to cedarline-payments')])
  })
})

describe('bullet claims against the stack', () => {
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
