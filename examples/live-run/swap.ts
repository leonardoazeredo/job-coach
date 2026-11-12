// Puts this checkout's text of each skill the coach loaded into a saved conversation, so a replay
// answers under the skill wording being tested and not the wording the run had.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// A loaded skill sits in the conversation as a user message that opens with its directory and
// holds the skill's text without the front matter.
const skillBody = (file: string): string =>
  readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\n/, '')

// The conversation file stores the text JSON-escaped; replacing it in that form changes no other
// byte of the file.
const escaped = (text: string): string => JSON.stringify(text).slice(1, -1)

const LOADED_SKILL = /Base directory for this skill: [^\\"]*\/skills\/([\w-]+)\\n\\n/

// Returns the names of the skills it changed. Only the line that loads a skill is touched, so a
// reply that quotes the skill is left as it was. A loaded skill whose old text is not found stops
// the replay, because the replies would be made under wording nobody meant to test.
export const swapLoadedSkills = (
  session: string,
  oldSkills: string,
  newSkills: string,
): string[] => {
  const lines = readFileSync(session, 'utf8').split('\n')
  const swapped = new Set<string>()
  const loaded = new Set<string>()
  for (const [i, line] of lines.entries()) {
    const name = LOADED_SKILL.exec(line)?.[1]
    if (name === undefined) continue
    loaded.add(name)
    const oldFile = join(oldSkills, name, 'SKILL.md')
    const newFile = join(newSkills, name, 'SKILL.md')
    if (!existsSync(oldFile) || !existsSync(newFile))
      throw new Error(
        `the skill ${name} was loaded in the run but is missing from the run's copy or from this checkout, so it cannot be swapped`,
      )
    const [from, to] = [skillBody(oldFile), skillBody(newFile)]
    if (from === to || !line.includes(escaped(from))) continue
    lines[i] = line.split(escaped(from)).join(escaped(to))
    swapped.add(name)
  }
  for (const name of loaded) {
    const same =
      skillBody(join(oldSkills, name, 'SKILL.md')) === skillBody(join(newSkills, name, 'SKILL.md'))
    if (!same && !swapped.has(name))
      throw new Error(
        `the saved conversation does not hold the old text of the skill ${name}, so it cannot be swapped`,
      )
  }
  if (swapped.size > 0) writeFileSync(session, lines.join('\n'))
  return [...swapped]
}

// The conversation files of the coach's saved sessions in a sample; none before turn 2's session.
const sessionFiles = (sample: string): string[] => {
  const projects = join(sample, 'claudehome', 'projects')
  if (!existsSync(projects)) return []
  return readdirSync(projects, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(join(projects, d.name))
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(projects, d.name, f)),
    )
}

// Must run before the sample's copy gets this checkout's skills: the copy's own skills are the old
// text to find.
export const swapSkillsInSample = (sample: string, root: string): string[] => {
  const oldSkills = join(sample, 'copy', '.claude', 'skills')
  const newSkills = join(root, '.claude', 'skills')
  const swapped = sessionFiles(sample).flatMap((f) => swapLoadedSkills(f, oldSkills, newSkills))
  return [...new Set(swapped)]
}

export const describeSwap = (swapped: string[]): string =>
  swapped.length > 0
    ? `skills swapped in the saved conversation: ${swapped.join(', ')}`
    : "no loaded skill differs from this checkout's"
