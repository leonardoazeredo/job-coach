// The notes a skill asks the coach to add beside a summary, which the one-framing rule lets
// through in addition to one framing sentence. A sentence is a note only when an entry here
// recognises it; nothing is judged from how a sentence looks. When a skill gains or loses a line
// that asks for a note, this list is the one place to change.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '../../scripts/lib/workspace.ts'

export type NoteEntry = {
  id: string
  // The skill file that asks for the note, and a phrase of the asking line; a test fails when the
  // phrase is missing from the file, so an entry cannot point at a line that is gone.
  skill: string
  anchor: string
  // How a sentence is recognised as this note.
  matches: RegExp
  // A sentence the entry must recognise.
  example: string
  // An ordinary framing sentence close to the entry's words that it must not recognise.
  nonExample?: string
}

// A sentence that presents the summary is never a note, whatever it mentions, because naming a
// topic is not stating what happened to it.
const OPENER = String.raw`\W*(?:here|below|above|these are|this is|those are|that is|that's|there (?:is|are)|the following)\b`
const FIRST = String.raw`\bI(?:'ve| have|'ll| will)?\s+`
// Where an item went, or that it stayed out, with the item as subject. A placing verb counts only
// with a destination after it, so "went with" is plain framing.
const PLACE = String.raw`(?:sits?|goes|go|went|(?:is|are|was|were)\s+(?:put|placed))\s+(?:under|into|in)\b`
const OUT = String.raw`(?:stays?\s+out|(?:is|are|was|were)\s+(?:(?!not\b|never\b)\w+\s+)?left\s+(?:out|off))\b`
// The coach's own statement that it put an item somewhere or left it out; "left out nothing" says
// no item was left out. "Put together" and "put ... below" present the summary instead.
const I_PLACED = String.raw`${FIRST}(?:put(?![^.]*\b(?:together|below|here)\b)|placed|left\s+(?:out|off)|kept\s+out)\b(?!\s+nothing)`

// Builds a recogniser from alternatives that are each a verb assertion about an item; the opener
// guard sits in front of all of them.
const sentenceMatching = (...alternatives: string[]) =>
  new RegExp(`^(?!${OPENER})(?=[^]*?(?:${alternatives.join('|')}))`, 'i')

const GAPS = String.raw`\bgaps?\b`
const PREFERENCE = String.raw`(?:rather\s+(?:not|avoid)|prefer\w*|avoid\w*|would like to avoid)`
const CONDITION = String.raw`\bcondition\b`
const HARD_LIMIT = String.raw`(?:hard[ -]limits?|deal-?breakers?)`

// Order matters when one sentence fits two entries: it is excused by the first entry that has not
// yet excused a sentence in the turn, so a second fit goes to the next unused entry.
export const NOTES: NoteEntry[] = [
  {
    id: 'career-gaps-left-out',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'say only that it was left out',
    matches: sentenceMatching(`${I_PLACED}[^.]*${GAPS}`, `${GAPS}[^.]*?${OUT}`),
    example: "I've left out the career gaps entry.",
    nonExample: 'Your gaps are not included in this list, which is fine.',
  },
  {
    id: 'preference-placed-or-left-out',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'or is left out, and you say which',
    matches: sentenceMatching(
      `${I_PLACED}[^.]*${PREFERENCE}`,
      `${PREFERENCE}[^.]*?(?:${PLACE}|${OUT})`,
    ),
    example: 'Your preference for no night shifts sits under what a good role has.',
    nonExample: "You'd rather not rush, so take your time going into each one.",
  },
  {
    id: 'hard-limits-empty',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'the list is empty and you say so plainly',
    matches: sentenceMatching(
      `\\byou\\s+(?:named|gave|listed|mentioned)\\s+(?:no|none|nothing)\\b[^.]*\\b(?:${HARD_LIMIT}|rules? (?:a )?roles? out)`,
      `${HARD_LIMIT}(?:\\s+list)?\\s+(?:is|are|stays?|remains?)\\s+(?:empty|blank)\\b`,
      `(?=[^.]*(?:${HARD_LIMIT}|rules? (?:a )?roles? out))[^.]*\\blist\\s+(?:is|stays?)\\s+(?:empty|blank)\\b`,
      `${FIRST}(?:left|kept)\\b[^.]*${HARD_LIMIT}[^.]*\\b(?:empty|blank)\\b`,
    ),
    example: 'You named no hard limits, so that list is empty.',
    nonExample: "Nothing here is a deal-breaker yet, so let's look.",
  },
  {
    id: 'title-condition-placed-or-left-out',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'Tell the user in one sentence where it went',
    matches: sentenceMatching(
      `${I_PLACED}[^.]*${CONDITION}`,
      `${CONDITION}[^.]*?(?:${PLACE}|${OUT})`,
      `\\bstays?\\s+out\\b[^.]*${CONDITION}`,
    ),
    example: 'The small-firm condition went into what a good role has.',
    nonExample: 'Here is the condition I went with.',
  },
  {
    id: 'generic-tool-name',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'stays generic in the file, and you say so',
    matches: sentenceMatching(
      String.raw`(?<!\bit\s)\bstays?\s+generic\b`,
      `${FIRST}(?:kept|left)\\s+(?!it\\b)[^.]*\\bgeneric\\b`,
    ),
    example: 'The route-planning package stays generic, since you could not name it.',
    nonExample: 'I kept it generic so it reads well.',
  },
]

// True when the skill file still holds the phrase of the line the entry points at.
export const anchorPresent = (e: NoteEntry, root = repoRoot()): boolean =>
  readFileSync(join(root, e.skill), 'utf8').replace(/\s+/g, ' ').includes(e.anchor)
