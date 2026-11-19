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
    expect(run.stderr).toContain(WORDING)
    expect(run.stderr).not.toMatch(/SyntaxError|\n\s+at /)
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
    stack.do_not_claim[1].patterns = ['angular(']
    repo.remove('cv/master.json')
    const refused = await draft('profile/stack.yaml', { do_not_claim: stack.do_not_claim })
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr).toContain(`error  ${WORDING}`)
  })
})
