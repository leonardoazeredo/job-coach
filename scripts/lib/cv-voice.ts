// Finds the wrong grammatical person and bracketed notes in prose that will be printed on a CV:
// the headline, summary, bullets, training, projects and a job's note, and an achievement's figure.
// Names (company, role, tech, skills, education) are not checked, and a pronoun in capitals, or in
// Title Case inside a phrase, is read as part of a name and skipped. Right after an opening
// bracket or a ; : … break, that needs a capitalised word next: "(Her Campus)" passes, "(My
// guess)" does not. A Title Case pronoun after . ! ? or a new line counts.
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
// -s, -d, -ed, -ing, -ly ("(estimated)", "(estimating)", "(approximately)"), so "Notebook",
// "Noteworthy" and "Todoist" pass.
const wordPattern = (word: string): RegExp =>
  word === 'I'
    ? /(?<![\w/-])I(?![\w/-])/g
    : new RegExp(`(?<!\\w)${escapeRegExp(word)}(?!\\w)`, 'gi')

const NOTE_ENDINGS = ['s', 'd', 'ed', 'es', 'ing', 'ly', 'imate', 'imately']
const APPROX_ENDINGS = ['imated', 'imating']

// The forms of one note word: itself, itself plus an ending, and for a word ending in "e" its
// stem plus "ing" ("estimating", "noting").
const noteForms = (word: string): string => {
  const base = escapeRegExp(word)
  const endings =
    word.toLowerCase() === 'approx' ? [...NOTE_ENDINGS, ...APPROX_ENDINGS] : NOTE_ENDINGS
  const forms = [`${base}(?:${endings.join('|')})?`]
  if (word.toLowerCase().endsWith('e')) forms.push(`${escapeRegExp(word.slice(0, -1))}ing`)
  return forms.join('|')
}

const notesIn = (bracket: string, words: string[]): string[] =>
  words.flatMap((word) =>
    [...bracket.matchAll(new RegExp(`(?<!\\w)(?:${noteForms(word)})(?!\\w)`, 'gi'))].map(
      (m) => m[0],
    ),
  )

// A pronoun of two or more capitals is an acronym or a state code ("ME" in Portland, ME), and a
// Title Case one inside a phrase is part of a name ("Her Campus"); the user cannot reword either
// away. Lowercase pronouns, and Title Case ones that start the text or follow . ! ? or a new
// line, count. Note words keep every case.
const HARD_BREAK = /(?:^|[.!?]\s+|\n\s*)$/
// After an opening bracket, or after ; : … and a space, the pronoun is a name only when a
// capitalised word follows ("(Her Campus)", "Clients: Me & Em"); "(My guess)" and
// "Shipped it: He scaled it" are not. "Shipped it: He Scaled It" slips through as a name.
const SOFT_BREAK = /(?:[([]\s*|[;:…]\s+)$/
const CAPITAL_NEXT = /^\s*(?:&\s*)?[A-Z]/
const isName = (found: string, before: string, after: string): boolean => {
  if (found.length < 2) return false
  if (found === found.toUpperCase()) return true
  if (!/^[A-Z][a-z]+$/.test(found) || HARD_BREAK.test(before)) return false
  return !SOFT_BREAK.test(before) || CAPITAL_NEXT.test(after)
}

const pronounsIn = (text: string, words: string[]): string[] =>
  words.flatMap((word) =>
    [...text.matchAll(wordPattern(word))]
      .filter((m) => !isName(m[0], text.slice(0, m.index), text.slice(m.index + m[0].length)))
      .map((m) => m[0]),
  )

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
