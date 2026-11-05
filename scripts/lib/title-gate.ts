// The Qualifying title gate. Which words make a title the user's kind of work come from their
// own search, so the gate works for any field; the engine holds only the words about level and
// function that rule a title out for nearly everyone.
import { type Problem, warning } from './problem.ts'
import { SEARCH_PROFILE } from './rules.ts'
import type { Rules } from './schema.ts'

type Lists = Pick<
  Rules['discovery'],
  'search_titles' | 'title_expansion' | 'field_terms' | 'excluded_words'
>

// Each group holds the forms of one word, because words match whole: "test" must not find
// "Latest", so "testing" has to be named. A user's word from a group lifts the whole group.
const ENGINE_EXCLUDED = [
  ['intern', 'interns', 'internship'],
  ['graduate', 'graduates', 'new grad'],
  ['junior'],
  ['apprentice', 'apprenticeship'],
  ['working student', 'werkstudent'],
  ['recruiter', 'recruiting', 'recruitment'],
  ['sales'],
  ['marketing'],
  ['designer'],
  ['manager'],
  ['director'],
  ['head of'],
  ['qa'],
  ['test', 'tester', 'testing'],
]

// + and # stay in a word, so "C#" and "C" are told apart.
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []

type Spot = { phrase: number; title: number }

// Consumes one word at the spot, however it is split: "front end" and "frontend" are the same
// letters, so the shorter side takes its next word until the two agree or differ. A last word
// "Engineer" also admits "Engineering", because job ads say "Product Engineering Lead" for
// "Product Engineer". Only "Engineer" gets it: appending "ing" to other "-er" words makes
// non-words ("Developering").
const takeWord = (phrase: string[], title: string[], at: Spot): Spot | undefined => {
  let p = at.phrase
  let t = at.title
  let a = phrase[p] ?? ''
  let b = title[t] ?? ''
  while (a !== b) {
    const lastEngineer = p === phrase.length - 1 && a === 'engineer' && b === 'engineering'
    if (lastEngineer) break
    if (b.startsWith(a) && p + 1 < phrase.length) a += phrase[++p]
    else if (a.startsWith(b) && t + 1 < title.length) b += title[++t]
    else return undefined
  }
  return { phrase: p + 1, title: t + 1 }
}

// `gap` lets one extra title word sit between two phrase words, so "Founding Engineer" also
// admits "Founding Frontend Engineer".
const matchesAt = (phrase: string[], title: string[], at: Spot, gap: boolean): boolean => {
  if (at.title >= title.length) return false
  const next = takeWord(phrase, title, at)
  if (!next) return false
  if (next.phrase === phrase.length) return true
  return (
    matchesAt(phrase, title, next, gap) ||
    (gap && matchesAt(phrase, title, { ...next, title: next.title + 1 }, gap))
  )
}

const holds = (title: string[], phrase: string[], gap = false): boolean =>
  phrase.length > 0 && title.some((_, i) => matchesAt(phrase, title, { phrase: 0, title: i }, gap))

export const qualifyingTitle = (lists: Lists): ((title: string) => boolean) => {
  const titles = [...lists.search_titles, ...lists.title_expansion].map(wordsOf)
  const terms = (lists.field_terms ?? []).map(wordsOf)
  const own = [...titles, ...terms]
  const excluded = [
    ...ENGINE_EXCLUDED.map((group) => group.map(wordsOf)).filter(
      (group) => !group.some((form) => own.some((words) => holds(words, form))),
    ),
    ...lists.excluded_words.map((word) => [wordsOf(word)]),
  ]
  return (title) => {
    const words = wordsOf(title)
    return (
      (titles.some((t) => holds(words, t, true)) || terms.some((t) => holds(words, t))) &&
      !excluded.some((group) => group.some((form) => holds(words, form)))
    )
  }
}

// An absent key means the question was never put, as in a copy older than the key; an empty
// list means the user said there are none.
export const titleGateProblems = (lists: Lists): Problem[] => {
  const own = [...lists.search_titles, ...lists.title_expansion, ...(lists.field_terms ?? [])]
  return [
    ...(lists.field_terms === undefined
      ? [
          warning(
            SEARCH_PROFILE,
            "discovery.field_terms is not there, so only titles that name a job title in this file qualify; ask which words in a job title show it is the user's kind of work",
          ),
        ]
      : []),
    ...own.flatMap((wanted) =>
      lists.excluded_words
        .filter((word) => holds(wordsOf(wanted), wordsOf(word)))
        .map((word) =>
          warning(
            SEARCH_PROFILE,
            `"${wanted}" holds the excluded word "${word}", so it can never qualify a title`,
          ),
        ),
    ),
  ]
}
