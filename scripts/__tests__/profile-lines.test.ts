import { describe, expect, it } from 'vitest'
import { ERROR_PREFIX } from '../lib/problem.ts'
import {
  droppedLine,
  isRefusalLine,
  isWriteOrDropLine,
  notValuesLine,
  notWrittenLine,
  writtenLine,
} from '../lib/profile-lines.ts'

describe('isRefusalLine', () => {
  it.each([
    [
      'an error line',
      `${ERROR_PREFIX}profile/identity.yaml: "Timezone" still holds the template's example`,
    ],
    ['an error line of a file in the folder root', `${ERROR_PREFIX}cv/master.json: x`],
    [
      'a line of input that could not be read',
      notValuesLine('profile/voice.md', 'Unexpected token'),
    ],
  ])('is true for %s', (_name, line) => {
    expect(isRefusalLine(line)).toBe(true)
  })

  it.each([
    ['a summary line', 'Name: A'],
    ['a line that only starts with error', 'error: failed'],
    ['an error line naming no file extension', `${ERROR_PREFIX}notapath: x`],
    ['an error line with the path not at the start of its message', `${ERROR_PREFIX}x y.yaml: z`],
    ['an indented refusal', `  ${ERROR_PREFIX}a.yaml: x`],
    [
      'a summary line that holds the words later',
      'Notes: the input could not be read as values: a.yaml',
    ],
    ['a warning', 'warn   a.yaml: x'],
  ])('is false for %s', (_name, line) => {
    expect(isRefusalLine(line)).toBe(false)
  })
})

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

  it.each([
    ['a summary line that holds the word later in it', 'Notes: dropped: the Friday handover'],
    ['a sentence that starts with the word', 'written by hand'],
    ['an indented line', '  written: x'],
    ['a capitalised line', 'Written: y'],
    ['a line with no space after the colon', 'written:x'],
  ])('is false for %s', (_name, line) => {
    expect(isWriteOrDropLine(line)).toBe(false)
  })
})
