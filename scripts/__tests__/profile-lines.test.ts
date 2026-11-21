import { describe, expect, it } from 'vitest'
import {
  droppedLine,
  isWriteOrDropLine,
  notWrittenLine,
  writtenLine,
} from '../lib/profile-lines.ts'

describe('isWriteOrDropLine', () => {
  it.each([
    ['a written line', writtenLine(['profile/voice.md'])],
    ['a written line of several files', writtenLine(['profile/voice.md', 'profile/wins.yaml'])],
    ['a dropped line', droppedLine(['profile/voice.md'])],
    ['a dropped line of several files', droppedLine(['profile/voice.md', 'profile/wins.yaml'])],
    ['a not-written line', notWrittenLine(['profile/voice.md'])],
    [
      'a not-written line of several files',
      notWrittenLine(['profile/voice.md', 'profile/wins.yaml']),
    ],
  ])('is true for %s', (_name, line) => {
    expect(isWriteOrDropLine(line)).toBe(true)
  })

  it('is false for a line of a summary', () => {
    expect(isWriteOrDropLine('Name: A')).toBe(false)
  })
})
