import { describe, expect, it } from 'vitest'
import { SLUG } from './fixtures.ts'
import {
  errors,
  larkspur,
  lintRole,
  requirementWarnings,
  useWorkspaceRepo,
  withoutBullets,
} from './workspace-repo.ts'

useWorkspaceRepo()

describe('requirement statuses', () => {
  const lint = lintRole

  it('passes the worked example', () => {
    withoutBullets()
    expect(lint()).toEqual([])
  })

  it('flags unknown competencies, bad refs and covered items without evidence', () => {
    larkspur.writeRequirements((r1, r2) => {
      r1.competency = 'charisma'
      r1.evidence = [{ ref: 'bank:brightwell#99', slots: [] }]
      r2.evidence = []
    })
    const messages = lint().map((p) => p.message)
    expect(messages).toContainEqual(expect.stringContaining('"charisma"'))
    expect(messages).toContainEqual(expect.stringContaining('no such experience-bank question'))
    expect(messages).toContainEqual(expect.stringContaining('covered with no evidence'))
  })

  it('fails duplicate ids', () => {
    larkspur.writeRequirements((_r1, r2) => {
      r2.id = 'r1'
    })
    expect(errors(lint())).toContainEqual(`${SLUG}: requirements: duplicate id r1`)
  })

  it('fails covered with missing slots, and passes it once marked partial', () => {
    larkspur.writeRequirements((_r1, r2) => {
      r2.missing_slots = ['outcome']
    })
    expect(errors(lint())).toEqual([
      `${SLUG}: requirements r2: covered with missing slots (outcome); mark it partial or fill them`,
    ])
    larkspur.writeRequirements((_r1, r2) => {
      r2.missing_slots = ['outcome']
      r2.status = 'partial'
    })
    expect(errors(lint())).toEqual([])
  })

  it('fails partial with no evidence, and passes it once marked gap', () => {
    larkspur.writeRequirements((r1) => {
      r1.evidence = []
    })
    expect(errors(lint())).toEqual([`${SLUG}: requirements r1: partial with no evidence`])
    larkspur.writeRequirements((r1) => {
      r1.evidence = []
      r1.status = 'gap'
    })
    expect(errors(lint())).toEqual([])
  })

  it.each(['gap', 'not-claimable'] as const)(
    'warns about %s that still lists evidence',
    (status) => {
      withoutBullets()
      larkspur.writeRequirements((r1) => {
        r1.status = status
      })
      expect(requirementWarnings()).toEqual([
        `${SLUG}: requirements r1: ${status} but lists evidence; update its status or remove the evidence`,
      ])
      larkspur.writeRequirements((r1) => {
        r1.status = status
        r1.evidence = []
      })
      expect(requirementWarnings()).toEqual([])
    },
  )

  it('warns about slot names that are not slots of the competency', () => {
    withoutBullets()
    larkspur.writeRequirements((r1) => {
      r1.missing_slots = ['charm']
    })
    expect(lint()).toEqual([
      {
        slug: SLUG,
        level: 'warning',
        message: 'requirements r1: slot "charm" is not a stakeholder-management slot',
      },
    ])
  })
})

describe('requirements answered by bullets', () => {
  const lint = lintRole

  it('warns once about a covered must requirement no bullet answers', () => {
    expect(requirementWarnings()).toEqual([
      `${SLUG}: requirements r2: must requirement marked covered is answered by no bullet`,
    ])
    larkspur.writeVariant((v) => {
      v.jobs[0]?.bullets[0]?.answers.push('r2')
    })
    expect(requirementWarnings()).toEqual([])
  })

  it('warns about a partial must requirement no bullet answers', () => {
    larkspur.writeRequirements((r1) => {
      r1.weight = 'must'
    })
    larkspur.writeVariant((v) => {
      for (const b of v.jobs.flatMap((j) => j.bullets)) b.answers = ['r2']
    })
    expect(requirementWarnings()).toEqual([
      `${SLUG}: requirements r1: must requirement marked partial is answered by no bullet`,
    ])
  })

  it('warns about a covered requirement of any weight no bullet answers, not a partial one', () => {
    larkspur.writeRequirements((_r1, r2) => {
      r2.weight = 'nice'
    })
    larkspur.writeVariant((v) => {
      for (const b of v.jobs.flatMap((j) => j.bullets)) b.answers = []
    })
    expect(requirementWarnings()).toEqual([
      `${SLUG}: requirements r2: covered but answered by no bullet`,
    ])
  })

  it('rejects an answers id that is not a requirement', () => {
    larkspur.writeVariant((v) => {
      const bullet = v.jobs[0]?.bullets[0]
      if (bullet) bullet.answers = ['r9']
    })
    expect(errors(lint())).toEqual([
      `${SLUG}: cv cedarline-payments bullet 1: answers "r9" is not in requirements.yaml`,
    ])
  })
})
