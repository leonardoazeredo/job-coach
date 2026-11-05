import { describe, expect, it } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { draft, personaFile, repo, useProfileRepo } from './profile-repo.ts'

useProfileRepo()

// A never-claim pattern that matches a true line of the person's own CV would fail every CV
// built for a role, so whichever of the two files is drafted second is refused.
const TRAINING = 'CPC Transport Manager (Operator Licence), 2020'
const manager = (pattern: string) => ({
  item: 'Holding a manager role',
  allowed_framing: 'My title is Transport Planner; I have not held a manager role.',
  patterns: [pattern],
})
const withTraining = () => {
  const master = JSON.parse(repo.read('cv/master.json'))
  master.training = [TRAINING]
  return master
}

describe('never-claim patterns and the CV', () => {
  it('refuses a pattern that matches a line of the CV', async () => {
    repo.write('cv/master.json', `${JSON.stringify(withTraining(), null, 2)}\n`)
    const refused = await draft('profile/stack.yaml', {
      do_not_claim: [manager('transport manager')],
    })
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr).toContain('"transport manager"')
    expect(refused.stderr).toContain(TRAINING)
  })

  it('takes a pattern narrow enough to miss the CV line', async () => {
    repo.write('cv/master.json', `${JSON.stringify(withTraining(), null, 2)}\n`)
    const taken = await draft('profile/stack.yaml', {
      do_not_claim: [manager('\\b(was|worked as|role as) (a |the )?transport manager')],
    })
    expect(taken.stderr).toBe('')
    expect(taken.code).toBe(0)
  })

  it('refuses a CV with a line a never-claim pattern on file matches', async () => {
    const stack = personaFile('profile/stack.yaml')
    stack.do_not_claim.push(manager('transport manager'))
    repo.writeYaml('profile/stack.yaml', stack)
    const refused = await draft('cv/master.json', withTraining())
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr).toContain('"transport manager"')
    expect(refused.stderr).toContain(TRAINING)
  })
})
