import { describe, expect, it } from 'vitest'
import { hasClash, narrow, settle } from '../lib/clash.ts'

const block = (ours: string[], before: string[], theirs: string[]) =>
  [
    '<<<<<<< yours',
    ...ours,
    '||||||| before',
    ...before,
    '=======',
    ...theirs,
    '>>>>>>> new version',
    '',
  ].join('\n')

describe('narrow', () => {
  it('settles a setting only one side changed and keeps the one both changed as a clash', () => {
    const text = block(
      ['stale: 10', 'follow: 5'],
      ['stale: 14', 'follow: 5'],
      ['stale: 21', 'follow: 3'],
    )
    const narrowed = narrow(text)
    expect(narrowed.settled).toEqual([{ from: 'new version', line: 'follow: 3' }])
    expect(settle(narrowed.text, 'ours')).toBe('stale: 10\nfollow: 3\n')
  })

  it('leaves a block whole when one side moved its lines', () => {
    const text = block(['v: 2', 'k: 1'], ['k: 1', 'v: 2'], ['k: 1', 'v: 3'])
    expect(narrow(text)).toEqual({ text, settled: [] })
    expect(settle(text, 'theirs')).toBe('k: 1\nv: 3\n')
  })

  it('leaves a paragraph whole, so its lines are never taken from different sides', () => {
    const text = block(
      ['rule: >', '  Under the floor the verdict is', '  match unless the user says so.'],
      ['rule: >', '  Below the floor the verdict is', '  skip unless the user says so.'],
      ['rule: >', '  Under the floor the verdict is', '  skip unless the user says so.'],
    )
    expect(narrow(text)).toEqual({ text, settled: [] })
  })

  it('leaves prose whole even when its lines read like settings', () => {
    const text = block(
      ['Note: mine', 'Then: same'],
      ['Note: old', 'Then: same'],
      ['Note: old', 'Then: new'],
    )
    expect(narrow(text, { lineByLine: false })).toEqual({ text, settled: [] })
  })
})

describe('hasClash', () => {
  it('finds a marker git left and passes text with none', () => {
    expect(hasClash(block(['a: 1'], ['a: 0'], ['a: 2']))).toBe(true)
    expect(hasClash('a: 1\nb: 2\n')).toBe(false)
  })
})
