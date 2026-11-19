import { describe, expect, it } from 'vitest'
import { check } from '../check.ts'
import { cvLint } from '../cv-lint.ts'
import { EXIT } from '../lib/problem.ts'
import { draft, personaFile, repo, useProfileRepo } from './profile-repo.ts'

useProfileRepo()

// A pattern that does not compile would leave its guard silently off, so it is an error
// wherever the stack file is read and a draft is refused over it.
const WORDING =
  'profile/stack.yaml: never-claim pattern "angular(" (Frontend framework development) is not a valid pattern: Unterminated group'

const breakPattern = () =>
  repo.editYaml<{ do_not_claim: { item: string; patterns: string[] }[] }>(
    'profile/stack.yaml',
    (stack) => {
      const entry = stack.do_not_claim.find((c) => c.item === 'Frontend framework development')
      if (entry) entry.patterns = ['angular(']
    },
  )

describe('an invalid never-claim pattern', () => {
  it('is one error from check even when no role has a tailored CV, with no stack trace', async () => {
    breakPattern()
    const run = await repo.run((args) => check(args, repo.workspace()))
    expect(run.code).toBe(EXIT.problems)
    expect(run.stderr.trim()).toBe(`error  ${WORDING}`)
  })

  it('is one error from cv-lint on a role with a tailored CV, with no stack trace', async () => {
    repo.workedExample()
    breakPattern()
    const run = await repo.run(cvLint)
    expect(run.code).toBe(EXIT.problems)
    expect(run.stderr.trim()).toBe(`error  ${WORDING}`)
  })

  it('does not refuse a Draft whose patterns all compile', async () => {
    const stack = personaFile('profile/stack.yaml')
    repo.remove('cv/master.json')
    const taken = await draft('profile/stack.yaml', { do_not_claim: stack.do_not_claim })
    expect(taken.stderr).toBe('')
    expect(taken.code).toBe(0)
  })

  it('is refused by the Draft, even with no cv/master.json to check it against', async () => {
    const stack = personaFile('profile/stack.yaml')
    const entry = stack.do_not_claim.find(
      (c: { item: string }) => c.item === 'Frontend framework development',
    )
    entry.patterns = ['angular(']
    repo.remove('cv/master.json')
    const refused = await draft('profile/stack.yaml', { do_not_claim: stack.do_not_claim })
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr).toContain(`error  ${WORDING}`)
  })

  it('is reported with its own reason for every bad pattern, whatever the pattern holds', async () => {
    const stack = personaFile('profile/stack.yaml')
    const entry = { item: 'Odd patterns', allowed_framing: 'None.', patterns: ['a: (', 'b['] }
    const refused = await draft('profile/stack.yaml', {
      do_not_claim: [...stack.do_not_claim, entry],
    })
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr.trim().split('\n')).toEqual([
      'error  profile/stack.yaml: never-claim pattern "a: (" (Odd patterns) is not a valid pattern: Unterminated group',
      'error  profile/stack.yaml: never-claim pattern "b[" (Odd patterns) is not a valid pattern: Unterminated character class',
    ])
  })
})

// An invalid pattern already on file is the record check's to report, so a master draft names
// only what a valid pattern beside it catches.
describe('a master draft against a stack with an invalid pattern on file', () => {
  const master = () => {
    const cv = JSON.parse(repo.read('cv/master.json'))
    cv.training = ['Frontend expert, 2020']
    return cv
  }

  it('is refused for the line a valid pattern catches, with no line for the invalid one', async () => {
    breakPattern()
    repo.editYaml<{ do_not_claim: { item: string; patterns: string[] }[] }>(
      'profile/stack.yaml',
      (stack) => {
        const entry = stack.do_not_claim.find((c) => c.item === 'Frontend framework development')
        entry?.patterns.push('frontend (expert|specialist)')
      },
    )
    const refused = await draft('cv/master.json', master())
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr.trim()).toBe(
      'error  cv/master.json: the line "Frontend expert, 2020" is caught by never-claim pattern "frontend (expert|specialist)" (Frontend framework development) in profile/stack.yaml; narrow that pattern there, then draft this file again',
    )
  })

  it('takes the line when the stack on file is unreadable, which the record check reports', async () => {
    repo.editYaml<Record<string, unknown>>('profile/stack.yaml', (stack) => {
      delete stack.tools
    })
    const taken = await draft('cv/master.json', master())
    expect(taken.stderr).toBe('')
    expect(taken.code).toBe(0)
  })
})
