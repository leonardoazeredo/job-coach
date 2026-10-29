import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SLUG } from './fixtures.ts'
import {
  errors,
  larkspur,
  proposeWin,
  repo,
  useWorkspaceRepo,
  withoutBullets,
  writeBullet,
} from './workspace-repo.ts'

useWorkspaceRepo()

describe('roleCv', () => {
  it('builds a role CV and writes cv.json and keywords.txt', () => {
    const rc = repo.workspace().roleCv(SLUG)
    expect(errors(rc.write())).toEqual([])
    expect(existsSync(rc.files.cvJson)).toBe(true)
    expect(existsSync(rc.files.keywords)).toBe(true)
  })

  it('reports a cv.json it cannot write as a problem, without throwing', () => {
    const rc = repo.workspace().roleCv(SLUG)
    mkdirSync(rc.files.cvJson, { recursive: true })
    mkdirSync(rc.files.keywords, { recursive: true })
    expect(errors(rc.write())).toEqual([
      expect.stringMatching(new RegExp(`^${SLUG}: cv/cv\\.json could not be written: EISDIR`)),
      expect.stringMatching(new RegExp(`^${SLUG}: cv/keywords\\.txt could not be written: EISDIR`)),
    ])
  })

  it('says cv.json was written when only keywords.txt fails', () => {
    const rc = repo.workspace().roleCv(SLUG)
    mkdirSync(rc.files.keywords, { recursive: true })
    const [problem, ...rest] = errors(rc.write())
    expect(rest).toEqual([])
    expect(problem).toMatch(/cv\/keywords\.txt could not be written: .*; cv\/cv\.json was written$/)
    expect(JSON.parse(readFileSync(rc.files.cvJson, 'utf8'))).toBeTypeOf('object')
  })

  it('lists only ad keywords that made it into the CV', () => {
    expect(repo.workspace().roleCv(SLUG).keywords).toEqual([])
    larkspur.writeVariant((v) => {
      v.jobs[0]?.bullets.push({
        text: 'Introduced idempotency keys on the card authorisation and capture calls.',
        sources: ['win:cl-idempotency-keys'],
        answers: ['r2'],
      })
    })
    expect(repo.workspace().roleCv(SLUG).keywords).toEqual(['idempotency'])
  })

  it('leaves out keywords that match only a JSON key or a job id', () => {
    larkspur.writeRequirements((_r1, r2) => {
      r2.keywords = ['bullets', 'cedarline-payments', 'OpenAPI']
    })
    expect(repo.workspace().roleCv(SLUG).keywords).toEqual(['OpenAPI'])
  })

  it('takes keywords only from covered and partial requirements', () => {
    larkspur.writeRequirements((r1, r2) => {
      r1.keywords = ['OpenAPI']
      r1.status = 'gap'
      r1.evidence = []
      r2.keywords = ['OpenAPI', 'GitHub Actions']
    })
    expect(repo.workspace().roleCv(SLUG).keywords).toEqual(['OpenAPI', 'GitHub Actions'])
    larkspur.writeRequirements((r1, r2) => {
      r1.keywords = ['OpenAPI']
      r2.status = 'gap'
      r2.evidence = []
    })
    expect(repo.workspace().roleCv(SLUG).keywords).toEqual(['OpenAPI'])
  })

  it('treats a missing variant as a fact until write() needs it', () => {
    withoutBullets()
    const rc = repo.workspace().roleCv(SLUG)
    expect(errors(rc.problems)).toEqual([])
    expect(errors(rc.write())).toEqual(['larkspur-backend-engineer: cv/bullets.yaml is missing'])
    expect(existsSync(rc.files.cvJson)).toBe(false)
  })

  it('refuses to write without requirements.yaml, even with a variant', () => {
    larkspur.write('cv/keywords.txt', 'earlier\n')
    larkspur.remove('requirements.yaml')
    const rc = repo.workspace().roleCv(SLUG)
    expect(errors(rc.write())).toEqual(['larkspur-backend-engineer: requirements.yaml is missing'])
    expect(existsSync(rc.files.cvJson)).toBe(false)
    expect(readFileSync(rc.files.keywords, 'utf8')).toBe('earlier\n')
  })

  it('returns the problems and writes nothing when there is no build', () => {
    repo.write('profile/wins.yaml', 'wins:\n  - slug: broken\n')
    const rc = repo.workspace().roleCv(SLUG)
    expect(rc.build).toBeUndefined()
    expect(errors(rc.write())).toEqual([
      expect.stringMatching(/^profile\/wins\.yaml: could not be read: /),
    ])
    expect(existsSync(rc.files.cvJson)).toBe(false)
  })

  it('fails an unknown slug, including one that escapes the pipeline', () => {
    expect(errors(repo.workspace().roleCv('../profile').problems)).toEqual([
      '../profile: no pipeline/../profile folder',
    ])
  })

  it('reports a broken profile before an unknown folder, the same from every operation', () => {
    repo.write('profile/wins.yaml', 'wins:\n  - slug: broken\n')
    const ws = repo.workspace()
    const expected = [
      expect.stringMatching(/^profile\/wins\.yaml: could not be read: /),
      'no-such-role: no pipeline/no-such-role folder',
    ]
    expect(errors(ws.lintCvs('no-such-role').problems)).toEqual(expected)
    expect(errors(ws.roleCv('no-such-role').problems)).toEqual(expected)
    expect(errors(ws.roleCv('no-such-role').evidence().problems)).toEqual(expected)
    expect(errors(ws.roleCv('no-such-role').write())).toEqual(expected)
  })
})

describe('evidence', () => {
  it('lists candidates for each requirement', () => {
    const { problems, evidence } = repo.workspace().roleCv(SLUG).evidence()
    expect(errors(problems)).toEqual([])
    expect(evidence[0]?.candidates.map((c) => c.ref)).toContain('bank:brightwell#4')
  })

  it('returns only refs that resolve when written into bullets.yaml', () => {
    proposeWin('bw-stakeholder-reviews', 'cedarline-payments')
    const { evidence } = repo.workspace().roleCv(SLUG).evidence()
    const refs = [...new Set(evidence.flatMap((r) => r.candidates.map((c) => c.ref)))]
    expect(refs).not.toContain('win:bw-stakeholder-reviews')
    expect(refs.length).toBeGreaterThan(0)
    writeBullet(undefined, 'Frontend engineer.', refs)
    expect(errors(repo.workspace().lintCvs(SLUG).problems)).toEqual([])
  })

  it('leaves out dropped and logistics requirements', () => {
    larkspur.writeRequirements((_r1, r2, file) => {
      file.requirements.push(
        { ...r2, id: 'r3', kind: 'logistics', status: 'covered' },
        { ...r2, id: 'r4', status: 'dropped' },
      )
    })
    expect(
      repo
        .workspace()
        .roleCv(SLUG)
        .evidence()
        .evidence.map((r) => r.id),
    ).toEqual(['r1', 'r2'])
  })

  it('reports a missing requirements file instead of throwing', () => {
    expect(errors(repo.workspace().roleCv('plain-role').evidence().problems)).toEqual([
      'plain-role: requirements.yaml is missing',
    ])
  })

  it('reports requirement and profile problems, and lists evidence while the requirements parse', () => {
    larkspur.writeVariant((v) => {
      v.summary = { text: 'Frontend engineer.', sources: ['bank:brightwell#4'], answers: ['r9'] }
    })
    const answered = repo.workspace().roleCv(SLUG).evidence()
    expect(errors(answered.problems)).toEqual([
      `${SLUG}: cv summary: answers "r9" is not in requirements.yaml`,
    ])
    expect(answered.evidence.map((r) => r.id)).toEqual(['r1', 'r2'])

    larkspur.write('cv/bullets.yaml', 'role: [unclosed\n')
    const unreadable = repo.workspace().roleCv(SLUG).evidence()
    expect(errors(unreadable.problems)).toEqual([
      expect.stringMatching(/^larkspur-backend-engineer: cv\/bullets\.yaml could not be read: /),
    ])
    expect(unreadable.evidence.map((r) => r.id)).toEqual(['r1', 'r2'])

    repo.write('profile/wins.yaml', 'wins:\n  - slug: broken\n')
    const noProfile = repo.workspace().roleCv(SLUG).evidence()
    expect(errors(noProfile.problems)).toEqual([
      expect.stringMatching(/^profile\/wins\.yaml: could not be read: /),
      expect.stringMatching(/^larkspur-backend-engineer: cv\/bullets\.yaml could not be read: /),
    ])
    expect(noProfile.evidence).toEqual([])
  })
})
