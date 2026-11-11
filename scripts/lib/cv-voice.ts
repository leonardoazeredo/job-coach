// Finds the wrong grammatical person and bracketed notes in text that will be printed on a CV.
// The word lists are config/cv.yaml's, so the user can edit them; these defaults stand in for a
// copy of the file that predates them.

import type { Rule } from './draft-fields.ts'

export type VoiceLists = {
  error_pronouns: string[]
  warning_pronouns: string[]
  note_words: string[]
}

export const DEFAULT_VOICE: VoiceLists = {
  error_pronouns: ['he', 'his', 'him', 'she', 'her', 'I', 'my', 'me'],
  warning_pronouns: ['they', 'their', 'we', 'our'],
  note_words: ['estimate', 'approx', 'unverified', 'tbc', 'todo', 'note'],
}

export type VoiceFinding = { level: 'error' | 'warning'; phrase: string }

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// "I" counts only as a capital standing alone, so I/O, CI/CD, IT and "other" trip nothing.
// Every other word is whole and case-insensitive; a slash there is a boundary ("he/she").
const wordPattern = (word: string): RegExp =>
  word === 'I'
    ? /(?<![\w/-])I(?![\w/-])/g
    : new RegExp(`(?<!\\w)${escapeRegExp(word)}(?!\\w)`, 'gi')

const wordsIn = (text: string, words: string[]): string[] =>
  words.flatMap((word) => [...text.matchAll(wordPattern(word))].map((m) => m[0]))

const BRACKETED = /\([^()\n]*\)|\[[^[\]\n]*\]/g

// A bracket that holds a note word or an error pronoun is reported whole; its words are then
// not reported again on their own.
export const voiceFindings = (text: string, lists: VoiceLists): VoiceFinding[] => {
  const found: VoiceFinding[] = []
  const noted = text.replace(BRACKETED, (bracket) => {
    if (wordsIn(bracket, [...lists.note_words, ...lists.error_pronouns]).length === 0)
      return bracket
    found.push({ level: 'error', phrase: bracket })
    return ' '.repeat(bracket.length)
  })
  for (const word of wordsIn(noted, lists.error_pronouns))
    found.push({ level: 'error', phrase: word })
  for (const word of wordsIn(noted, lists.warning_pronouns))
    found.push({ level: 'warning', phrase: word })
  return found.filter((f, i) => found.findIndex((g) => g.phrase === f.phrase) === i)
}

export const voiceErrors = (text: string, lists: VoiceLists): string[] =>
  voiceFindings(text, lists)
    .filter((f) => f.level === 'error')
    .map((f) => f.phrase)

// A figure is quoted whole on every CV that uses its number, so a pronoun or a note in it reaches
// all of them and no bullet can be reworded around it. The rule cannot read the user's own
// word lists, so it holds to the defaults.
export const FIGURE: Rule = {
  holds: (v) => typeof v !== 'string' || voiceErrors(v, DEFAULT_VOICE).length === 0,
  needs:
    'a figure worded as it reads on a CV, with no he, she, I, my or similar word and no bracketed note such as "(his estimate)"',
}
