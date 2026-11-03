import { describe, expect, it } from 'vitest'
import { repo, useWorkspaceRepo } from './workspace-repo.ts'

useWorkspaceRepo()

type Loose = { fit: { hard_limits?: unknown } }

describe('fit.hard_limits in the search profile', () => {
  it('carries the persona hard limits and loads a search profile that has none', () => {
    expect(repo.workspace().rules().rules?.fit.hard_limits).toEqual([
      'No night or on-call shifts',
      'No employer in gambling or weapons',
    ])
    repo.editYaml<Loose>('profile/search.yaml', (r) => {
      delete r.fit.hard_limits
    })
    const { rules, problems } = repo.workspace().rules()
    expect(problems).toEqual([])
    expect(rules?.fit.hard_limits).toBeUndefined()
  })

  it('names a hard_limits value that is not a list of strings', () => {
    repo.editYaml<Loose>('profile/search.yaml', (r) => {
      r.fit.hard_limits = 'no nights'
    })
    expect(repo.workspace().rules().problems[0]?.message).toMatch(/fit\.hard_limits/)
  })
})
