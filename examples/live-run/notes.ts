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
}

const PLACED = 'sits?|goes|go|went|put|placed|left out|stays? out|under|into'

// Order matters when one sentence fits two entries: it is excused by the first entry that has
// not yet excused a sentence in the turn.
export const NOTES: NoteEntry[] = [
  {
    id: 'career-gaps-left-out',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'say only that it was left out',
    matches:
      /\b(?:left out|leave out|left off|not included)\b[^.]*\bgaps?\b|\bgaps?\b[^.]*\b(?:left out|left off|not included)\b/i,
    example: "I've left out the career gaps entry.",
  },
  {
    id: 'preference-placed-or-left-out',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'or is left out, and you say which',
    matches: new RegExp(
      `\\b(?:rather not|rather avoid|prefer(?:ence)?s?|would like to avoid)\\b[^.]*\\b(?:${PLACED}|good role)\\b`,
      'i',
    ),
    example: 'Your preference for no night shifts sits under what a good role has.',
  },
  {
    id: 'hard-limits-empty',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'the list is empty and you say so plainly',
    matches:
      /\b(?:no|none|nothing)\b[^.]*\b(?:hard limits?|rules? (?:a )?roles? out|deal-?breakers?)\b|\b(?:hard limits?|deal-?breakers?)\b[^.]*\b(?:empty|none)\b/i,
    example: 'You named no hard limits, so that list is empty.',
  },
  {
    id: 'title-condition-placed-or-left-out',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'Tell the user in one sentence where it went',
    matches: new RegExp(
      `\\bcondition\\b[^.]*\\b(?:${PLACED})\\b|\\b(?:stays? out|left out)\\b[^.]*\\bcondition\\b`,
      'i',
    ),
    example: 'The small-firm condition went into what a good role has.',
  },
  {
    id: 'generic-tool-name',
    skill: '.claude/skills/onboarding/SKILL.md',
    anchor: 'stays generic in the file, and you say so',
    matches: /\bstays? generic\b|\b(?:left|kept) (?:it )?generic\b/i,
    example: 'The route-planning package stays generic, since you could not name it.',
  },
]

// True when the skill file still holds the phrase of the line the entry points at.
export const anchorPresent = (e: NoteEntry, root = repoRoot()): boolean =>
  readFileSync(join(root, e.skill), 'utf8').replace(/\s+/g, ' ').includes(e.anchor)
