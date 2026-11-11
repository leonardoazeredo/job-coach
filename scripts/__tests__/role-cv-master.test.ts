import { describe, expect, it } from 'vitest'
import { SLUG, variant } from './fixtures.ts'
import { degree, editMaster, larkspur, messages, repo, writeBullets } from './role-cv-helpers.ts'

describe('claims in master-only sections', () => {
  it('rejects a do_not_claim item in training', () => {
    editMaster((m) => {
      m.training = ['Angular course']
    })
    const { problems } = repo.workspace().lintCvs(SLUG)
    expect(messages(problems, 'error')).toContainEqual(
      expect.stringContaining('do_not_claim "Frontend framework development"'),
    )
  })

  it('rejects a never_say phrase in languages', () => {
    editMaster((m) => {
      m.languages = ['English (native)', 'halved cloud spend']
    })
    const { problems } = repo.workspace().lintCvs(SLUG)
    expect(messages(problems, 'error')).toContainEqual(expect.stringContaining('never_say phrase'))
  })

  it('credits a keyword found only in education, and flags a do_not_claim phrase in it', () => {
    editMaster((m) => {
      m.education = [degree('BSc Zorbology (Angular)')]
    })
    larkspur.writeRequirements((_r1, r2) => {
      r2.keywords = ['Zorbology']
    })
    const ws = repo.workspace()
    expect(ws.roleCv(SLUG).keywords).toEqual(['Zorbology'])
    expect(messages(ws.lintCvs(SLUG).problems, 'error')).toContainEqual(
      expect.stringContaining('do_not_claim'),
    )
  })

  it('reports only the build error for a Variant job missing from history', () => {
    larkspur.writeVariant((v) => {
      v.jobs.push({
        id: 'acme',
        bullets: [{ text: 'Did a thing.', sources: ['win:bw-intern-programme'], answers: [] }],
      })
    })
    const { problems } = repo.workspace().lintCvs(SLUG)
    expect(messages(problems, 'error')).toEqual([expect.stringContaining('"acme"')])
  })
})

describe('stack limits in master-only text', () => {
  const limitErrors = () =>
    messages(repo.workspace().lintCvs(SLUG).problems, 'error').filter((m) =>
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
