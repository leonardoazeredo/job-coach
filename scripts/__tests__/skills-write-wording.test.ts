import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../lib/workspace.ts'

// Reads the engine's own skills: they are the text under test, not a fixture.
const SKILLS = join(repoRoot(), '.claude', 'skills')
const skill = (name: string) => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
const names = readdirSync(SKILLS)

describe('skills write profile files through the Draft command', () => {
  it.each(['onboarding', 'cv-tailor', 'experience-mining', 'interview-debrief', 'take-home'])(
    '%s names the command',
    (name) => {
      expect(skill(name)).toContain('scripts/profile.ts')
    },
  )

  it.each(names)(
    '%s does not tell the coach to copy a template or strip comments by hand',
    (name) => {
      const text = skill(name)
      expect(text).not.toMatch(/CHANGE_ME/)
      expect(text).not.toMatch(/strip the template/i)
      expect(text).not.toMatch(/scratch path/i)
    },
  )

  it('lets the Draft summary escape the rule to summarise tool output', () => {
    const plain = readFileSync(join(repoRoot(), 'CLAUDE.md'), 'utf8')
      .split('## ')
      .find((s) => s.startsWith('Plain words'))
    expect(plain).toContain('relayed whole')
  })

  it('names only scripts that exist', () => {
    const named = names.flatMap((name) =>
      [...skill(name).matchAll(/node (scripts\/[\w/.-]+\.ts)/g)].map((m) => m[1] as string),
    )
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((s) => !existsSync(join(repoRoot(), s)))).toEqual([])
  })
})

describe('onboarding records each answer as given', () => {
  const text = skill('onboarding')
  const identity = readFileSync(
    join(repoRoot(), 'templates', 'profile', 'identity.example.yaml'),
    'utf8',
  )

  it('keeps a preference out of the hard limits', () => {
    expect(text).toMatch(/"I'd rather avoid"[^.]*a preference, not a limit/)
    expect(text).toContain('rules a role out')
  })

  it('sends pronouns to coach.md only and never to identity.yaml', () => {
    expect(text).toMatch(/Pronouns \(2\)[^.]*only into `profile\/coach\.md`/)
    expect(identity).not.toMatch(/pronoun/i)
  })

  it('names, for the identity items, keys that identity.yaml holds', () => {
    const place = text.split('Each answer has one named place.')[1]?.split('\n\n')[0] ?? ''
    const keys = [...place.matchAll(/`([a-z_.]+)`/g)].map((m) => (m[1] as string).split('.')[0])
    for (const k of [
      'name',
      'locale',
      'languages',
      'location',
      'right_to_work',
      'availability',
      'compensation',
      'work_setup',
    ]) {
      expect(keys).toContain(k)
      expect(identity).toMatch(new RegExp(`^${k}:`, 'm'))
    }
  })

  it('never states that the user has no gaps', () => {
    expect(text).toContain('"There are no gaps" is never yours to state')
  })

  it('tells the user what a refusal needs without naming a file', () => {
    expect(text).toContain('never naming a file or a key')
  })

  it('asks wording and overclaim as one question and says what a partial reply does', () => {
    const wins = text.split('### 4. Wins')[1]?.split('### 5.')[0] ?? ''
    expect(wins).toContain('one question that covers both the wording and the overclaim')
    expect(wins).toContain('answers only part')
    expect(wins).not.toContain('request no further figure')
    expect(wins).toMatch(/nothing to change[^.]*spends no further turn/)
    expect(wins).toContain("only on the user's yes")
  })

  it('skips settled identity answers but keeps them in the summary and asks about inferred ones', () => {
    const step = text.split('### 3. Identity and targets')[1] ?? ''
    expect(step).toContain('source or an earlier answer already settles')
    expect(step).toContain('still appears in the summary')
    expect(step).toContain('inferred stays a question')
    expect(step).toContain('do not ask for others')
  })

  it('drafts the empty lessons list beside the last summary', () => {
    expect(text).toContain('let that one yes cover both')
  })

  it('keeps offers, framing and the lessons draft out of the way of questions', () => {
    expect(text).toContain('only thing asked in its reply')
    expect(text).toContain('waits for a reply of its own, or for the end of setup')
    expect(text).toContain('never mentions a command, a tool or printing')
    expect(text).toContain('Never draft it before step 7 begins')
    expect(text).toContain('ask about the list once more on its own')
    expect(text).toContain('Say that nothing is left only when no draft or offer is waiting')
  })

  it('does not repeat settled identity questions and names the timezone exception', () => {
    expect(text).toContain('the timezone follows from a city the user gave')
    expect(text).toContain('already answered')
    expect(text).toContain('the discipline (item 18) is not asked')
  })

  it('keeps file names out of the markdown templates the user reads', () => {
    const dir = join(repoRoot(), 'templates', 'profile')
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/`[^`]*\.(yaml|json)`/)
    }
  })

  it('writes a pack with the labels the user saw', () => {
    expect(text).toContain('the `label` values exactly as they will be written')
    expect(text).toContain('write the file with their words in `label` and keep each `id`')
  })

  it('keeps a condition on a title or says it was left out', () => {
    expect(text).toContain('is never dropped')
    expect(text).toContain("the condition goes into `ideal_role_criteria` in the user's words")
  })

  it('never says nothing is left in the reply that makes an offer', () => {
    expect(text).toContain('never in the reply that makes an offer')
  })

  it('drafts the lessons list in the turn of the last summary, not after it', () => {
    expect(text).toContain('never in the turn after it')
  })

  it('states no reason for the user, framing sentences included', () => {
    expect(text).toContain("in a summary's framing sentence or anywhere else")
  })
})

describe('the coach names an achievement by its words', () => {
  it('forbids a number or an ordinal, even in passing', () => {
    const plain = readFileSync(join(repoRoot(), 'CLAUDE.md'), 'utf8')
      .split('## ')
      .find((s) => s.startsWith('Plain words'))
    expect(plain).toContain('never by a number or an ordinal, even in passing')
  })
})
