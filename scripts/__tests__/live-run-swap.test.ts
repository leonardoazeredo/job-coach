import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { swapLoadedSkills, swapSkillsInSample } from '../../examples/live-run/swap.ts'

const tmp = mkdtempSync(join(tmpdir(), 'swap-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const FRONT = '---\nname: voice\ndescription: d\n---\n'
const OLD = '# Voice\n\nAsk for "two" samples: then draft.\n\tIndented line\n'
const NEW = '# Voice\n\nAsk for "three" samples: then draft.\nbegin with kestrel\n'

const skills = (name: string, files: Record<string, string>) => {
  const dir = join(tmp, name)
  for (const [skill, text] of Object.entries(files)) {
    mkdirSync(join(dir, skill), { recursive: true })
    writeFileSync(join(dir, skill, 'SKILL.md'), text)
  }
  return dir
}

// Lines as the coach stores them: one JSON object per line.
const sessionLines = (body: string) => [
  JSON.stringify({ type: 'user', message: { content: 'hello' }, note: 'keep é \\ "' }),
  JSON.stringify({
    type: 'user',
    isMeta: true,
    message: {
      content: [
        { type: 'text', text: `Base directory for this skill: /w/.claude/skills/voice\n\n${body}` },
      ],
    },
  }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: body }] } }),
]

const session = (name: string, lines: string[]) => {
  const file = join(tmp, name)
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

describe('swapping loaded skills in a saved conversation', () => {
  it('puts the new text in and leaves every other byte alone', () => {
    const lines = sessionLines(OLD)
    const file = session('a.jsonl', lines)
    const swapped = swapLoadedSkills(
      file,
      skills('a-old', { voice: FRONT + OLD }),
      skills('a-new', { voice: FRONT + NEW }),
    )
    expect(swapped).toEqual(['voice'])
    // The assistant line quotes the same text; only the skill's own message is a swap target.
    const expected = [lines[0], sessionLines(NEW)[1], lines[2]]
    expect(readFileSync(file, 'utf8')).toBe(`${expected.join('\n')}\n`)
  })

  it('leaves the file untouched when the working tree text equals the run’s', () => {
    const lines = sessionLines(OLD)
    const file = session('b.jsonl', lines)
    const swapped = swapLoadedSkills(
      file,
      skills('b-old', { voice: FRONT + OLD }),
      skills('b-new', { voice: `---\nname: voice\ndescription: other\n---\n${OLD}` }),
    )
    expect(swapped).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(`${lines.join('\n')}\n`)
  })

  it('refuses a loaded skill whose old text is not in the conversation and names it', () => {
    const lines = sessionLines('some other wording\n')
    const file = session('c.jsonl', lines)
    expect(() =>
      swapLoadedSkills(
        file,
        skills('c-old', { voice: FRONT + OLD }),
        skills('c-new', { voice: FRONT + NEW }),
      ),
    ).toThrow(/skill voice/)
    expect(readFileSync(file, 'utf8')).toBe(`${lines.join('\n')}\n`)
  })

  it('refuses a loaded skill this checkout no longer has', () => {
    const file = session('d.jsonl', sessionLines(OLD))
    expect(() =>
      swapLoadedSkills(file, skills('d-old', { voice: FRONT + OLD }), skills('d-new', {})),
    ).toThrow(/skill voice/)
  })

  it('ignores a skill the conversation never loaded', () => {
    const lines = [JSON.stringify({ type: 'user', message: { content: 'hi' } })]
    const file = session('e.jsonl', lines)
    const swapped = swapLoadedSkills(
      file,
      skills('e-old', { voice: FRONT + OLD }),
      skills('e-new', { voice: FRONT + NEW }),
    )
    expect(swapped).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(`${lines.join('\n')}\n`)
  })
})

describe('swapping in a sample folder', () => {
  const sample = (name: string, withSession: boolean) => {
    const dir = join(tmp, name)
    mkdirSync(join(dir, 'copy', '.claude', 'skills', 'voice'), { recursive: true })
    writeFileSync(join(dir, 'copy', '.claude', 'skills', 'voice', 'SKILL.md'), FRONT + OLD)
    if (withSession) {
      mkdirSync(join(dir, 'claudehome', 'projects', '-w'), { recursive: true })
      writeFileSync(
        join(dir, 'claudehome', 'projects', '-w', 's.jsonl'),
        `${sessionLines(OLD).join('\n')}\n`,
      )
    }
    return dir
  }
  const root = (name: string) => {
    const dir = join(tmp, name)
    mkdirSync(join(dir, '.claude', 'skills', 'voice'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'skills', 'voice', 'SKILL.md'), FRONT + NEW)
    return dir
  }

  it('swaps the session found under the sample and names the skill once', () => {
    const dir = sample('f', true)
    expect(swapSkillsInSample(dir, root('f-root'))).toEqual(['voice'])
    expect(readFileSync(join(dir, 'claudehome', 'projects', '-w', 's.jsonl'), 'utf8')).toContain(
      'begin with kestrel',
    )
  })

  it('swaps nothing for a sample that has no saved session yet', () => {
    expect(swapSkillsInSample(sample('g', false), root('g-root'))).toEqual([])
  })
})
