// Finds the wrong grammatical person and bracketed notes in text that will be printed on a CV.
// The word lists are config/cv.yaml's, so the user can edit them; these defaults stand in for a
// copy of the file that predates them. The draft rule (FIGURE) cannot read the config and always
// uses the defaults, so an edited list changes the CV lint and the record check, not the Draft.

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
// A note word inside a bracket is also matched as a whole word, or that word with an ending such as
// -s, -d, -ed, -ing, -ly ("(estimated)", "(approximately)"), so "Notebook" and "Todoist" pass.
const wordPattern = (word: string): RegExp =>
  word === 'I'
    ? /(?<![\w/-])I(?![\w/-])/g
    : new RegExp(`(?<!\\w)${escapeRegExp(word)}(?!\\w)`, 'gi')

const wordsIn = (text: string, words: string[]): string[] =>
  words.flatMap((word) => [...text.matchAll(wordPattern(word))].map((m) => m[0]))

const NOTE_ENDINGS = 's|d|ed|es|ing|ly|imate|imately'

const notesIn = (bracket: string, words: string[]): string[] =>
  words.flatMap((word) =>
    [
      ...bracket.matchAll(
        new RegExp(`(?<!\\w)${escapeRegExp(word)}(?:${NOTE_ENDINGS})?(?!\\w)`, 'gi'),
      ),
    ].map((m) => m[0]),
  )

// A pronoun of two or more capitals is an acronym or a state code ("ME" in Portland, ME), which
// the user cannot reword away, so only lowercase and Title Case count. Note words keep every case.
const pronounsIn = (text: string, words: string[]): string[] =>
  wordsIn(text, words).filter((found) => found.length < 2 || found !== found.toUpperCase())

const BRACKETED = /\([^()\n]*\)|\[[^[\]\n]*\]/g

// A bracket that holds a note word or an error pronoun is reported whole; its words are then
// not reported again on their own.
export const voiceFindings = (text: string, lists: VoiceLists): VoiceFinding[] => {
  const found: VoiceFinding[] = []
  const noted = text.replace(BRACKETED, (bracket) => {
    if (
      notesIn(bracket, lists.note_words).length +
        pronounsIn(bracket, lists.error_pronouns).length ===
      0
    )
      return bracket
    found.push({ level: 'error', phrase: bracket })
    return ' '.repeat(bracket.length)
  })
  for (const word of pronounsIn(noted, lists.error_pronouns))
    found.push({ level: 'error', phrase: word })
  for (const word of pronounsIn(noted, lists.warning_pronouns))
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
