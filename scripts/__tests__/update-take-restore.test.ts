import { describe, expect, it, vi } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { updateCommand } from '../update.ts'
import { cloned, runner, upstream, work } from './update-helpers.ts'

const taken = vi.hoisted(() => ({ result: undefined as object | undefined }))
vi.mock('../lib/update-git.ts', async (original) => {
  const real = await original<typeof import('../lib/update-git.ts')>()
  return {
    ...real,
    takeSide: (...args: Parameters<typeof real.takeSide>) => taken.result ?? real.takeSide(...args),
  }
})

describe('the take command when the folder could not be put back', () => {
  it('names the files to look at and does not say nothing was changed', async () => {
    cloned({ 'docs/a.md': 'one\n' })
    taken.result = {
      kind: 'failed',
      output: 'unable to unlink old',
      restored: false,
      files: ['docs/b.md', 'the list of files git keeps'],
    }
    const lines: unknown[] = []
    const errors: unknown[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line) => void lines.push(line))
    const error = vi.spyOn(console, 'error').mockImplementation((line) => void errors.push(line))
    const code = await updateCommand(['take', 'ours', 'docs/a.md'], work(), {
      engineUrl: upstream(),
      run: runner().run,
    })
    log.mockRestore()
    error.mockRestore()
    expect(code).toBe(EXIT.problems)
    expect(lines).toEqual([
      'not taken: the file could not be settled and the folder could not be put back as it was; look at: docs/b.md, the list of files git keeps',
    ])
    expect(errors).toEqual(['unable to unlink old'])
  })
})
