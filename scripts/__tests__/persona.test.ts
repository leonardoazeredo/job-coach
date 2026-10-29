// The example persona is both the shipped sample and the fixture every other test copies,
// so it has to be valid on its own.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openWorkspace, repoRoot } from '../lib/workspace.ts'
import { SLUG } from './fixtures.ts'
import { PERSONA } from './temp-repo.ts'
import { errors } from './workspace-repo.ts'

describe('example persona', () => {
  const workspace = openWorkspace(PERSONA)

  it('passes the record check with its three roles', () => {
    const result = workspace.check()
    expect(errors(result.problems)).toEqual([])
    expect(result.roles).toBe(3)
  })

  it('lints the role CV it ships without errors', () => {
    const { problems, checked } = workspace.lintCvs(SLUG)
    expect(checked).toBe(1)
    expect(errors(problems)).toEqual([])
  })

  // The persona is a standalone repo, so it carries its own copy of the engine rules.
  it('carries the engine rules unchanged', () => {
    expect(readFileSync(join(PERSONA, 'config/rules.yaml'), 'utf8')).toBe(
      readFileSync(join(repoRoot(), 'config/rules.yaml'), 'utf8'),
    )
  })
})
