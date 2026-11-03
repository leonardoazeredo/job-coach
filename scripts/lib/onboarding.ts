// Which onboarding sections (.claude/skills/onboarding) are unfinished: a file is absent, or
// exists but still contains PLACEHOLDER (reported separately, so a half-filled template cannot
// pass as done). Files are never parsed here; check.ts owns validity.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The token the templates in templates/ put in values the user must replace. It counts anywhere
// in a file, comments included, so the template headers that name it must be stripped on write.
export const PLACEHOLDER = 'CHANGE_ME'

// Shown in place of a file when the identity names no pack, so the board says what to set.
const NO_PACK = 'competency_pack in profile/identity.yaml'

export type OnboardingSection = {
  id: string
  label: string
  // Required sections are the ones the skill will not let the user defer; the rest can wait.
  required: boolean
  // Offered, never nagged: the board lists it only beside other unfinished sections.
  optIn: boolean
  missing: string[]
  placeholders: string[]
}

type Spec = Pick<OnboardingSection, 'id' | 'label' | 'required' | 'optIn'> & { files: string[] }

const specs = (pack: string | undefined): Spec[] => [
  {
    id: 'cv-import',
    label: 'CV import: history, stack and master CV',
    required: true,
    optIn: false,
    files: ['profile/history.yaml', 'profile/stack.yaml', 'cv/master.json'],
  },
  {
    id: 'identity',
    label: 'Identity and targets',
    required: true,
    optIn: false,
    files: ['profile/identity.yaml', 'profile/search.yaml', 'profile/coach.md'],
  },
  {
    id: 'wins',
    label: 'Wins with confirmed metrics',
    required: false,
    optIn: false,
    files: ['profile/wins.yaml'],
  },
  {
    id: 'voice',
    label: 'Voice',
    required: false,
    optIn: false,
    files: ['profile/voice.md'],
  },
  {
    id: 'competency-pack',
    label: 'Competency pack',
    required: true,
    optIn: false,
    files: pack ? [`config/competencies/${pack}.yaml`] : [],
  },
  {
    id: 'sensitive',
    label: 'Sensitive sections: private history, standard answers',
    required: false,
    optIn: true,
    files: ['profile/history-private.yaml', 'profile/standard-answers.yaml'],
  },
]

const hasPlaceholder = (path: string): boolean => {
  try {
    return readFileSync(path, 'utf8').includes(PLACEHOLDER)
  } catch {
    return false
  }
}

// Only sections with something left are returned. `pack` is the competency pack the identity
// names; undefined (no pack named, or no readable identity) leaves the pack step unfinished
// rather than assuming one.
export const onboardingStatus = (root: string, pack: string | undefined): OnboardingSection[] =>
  specs(pack).flatMap(({ files, ...section }) => {
    const missing = files.filter((f) => !existsSync(join(root, f)))
    if (section.id === 'competency-pack' && !pack) missing.push(NO_PACK)
    const placeholders = files.filter((f) => !missing.includes(f) && hasPlaceholder(join(root, f)))
    return missing.length + placeholders.length === 0 ? [] : [{ ...section, missing, placeholders }]
  })

// The board shows the list once something besides an opt-in section is unfinished.
export const worthListing = (sections: OnboardingSection[]): boolean =>
  sections.some((s) => !s.optIn)

// The board takes its thresholds from profile/search.yaml (with config/rules.yaml), and today
// from profile/identity.yaml unless --today is given, so a board that fails while either file is
// absent means the profile is still being set up. Only then does the board command list the
// sections instead of reporting problems, even when that failure would also have been a problem.
// Only absent files count: a file that exists but still holds CHANGE_ME is the user's to fix, so
// a failure it causes stays a problem, as does any failure with both files present.
export const boardInputsMissing = (sections: OnboardingSection[]): boolean =>
  sections.some((s) =>
    s.missing.some((f) => f === 'profile/identity.yaml' || f === 'profile/search.yaml'),
  )

const sectionTag = (s: OnboardingSection): string => {
  if (s.required) return 'required'
  return s.optIn ? 'optional' : 'can wait'
}

export const renderOnboarding = (sections: OnboardingSection[]): string => {
  const lines = ['## Onboarding unfinished']
  for (const s of sections) {
    const tag = sectionTag(s)
    const left = [
      ...s.missing.map((f) => `${f} missing`),
      ...s.placeholders.map((f) => `${f} still has ${PLACEHOLDER}`),
    ]
    lines.push(`- ${s.id} (${tag}): ${s.label}; ${left.join(', ')}`)
  }
  lines.push('', 'Run the onboarding skill (/onboarding) to finish these.')
  return `${lines.join('\n')}\n`
}
