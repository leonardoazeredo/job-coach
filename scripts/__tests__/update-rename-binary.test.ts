import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { takeSide } from '../lib/update-git.ts'
import { commitEngine, start } from './update-clash-helpers.ts'
import { cloned, g, upstream, userCommit, work } from './update-helpers.ts'

const TEXT = Array.from({ length: 12 }, (_, i) => `line ${i + 1}\n`).join('')
const A = 'docs/a.md'
const B = 'docs/b.md'
const C = 'docs/c.md'

describe('two different files for the two new names of a binary', () => {
  const bin = (tail: string) => `\0${TEXT}${tail}\n`
  const scene = () => {
    cloned({ [A]: bin('base') })
    g(work(), 'mv', A, B)
    userCommit({ [B]: bin('mine') }, 'Saved: rename')
    g(upstream(), 'mv', A, C)
    writeFileSync(join(upstream(), C), bin('new'))
    commitEngine('Rename')
    return start().git
  }
  const onDisk = () =>
    Object.fromEntries(
      [A, B, C].map((rel) => {
        const path = join(work(), rel)
        return [rel, existsSync(path) ? readFileSync(path, 'utf8') : null]
      }),
    )
  const state = () => ({ status: g(work(), 'status', '--short'), disk: onDisk() })

  it("counts the other side's version at the kept name as an edit by hand", () => {
    const git = scene()
    writeFileSync(join(work(), B), bin('new'))
    const before = state()
    expect(takeSide(git, 'ours', A, { text: 'ours' })).toEqual({ kind: 'hand-edited', files: [B] })
    expect(state()).toEqual(before)
  })

  it('takes the same side when the kept name still holds its own version', () => {
    const git = scene()
    expect(takeSide(git, 'ours', A, { text: 'ours' })).toEqual({ kind: 'taken', left: [] })
    expect(onDisk()).toEqual({ [A]: null, [B]: bin('mine'), [C]: null })
  })
})
