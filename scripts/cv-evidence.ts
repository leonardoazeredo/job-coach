// Lists candidate evidence for each requirement in pipeline/<slug>/requirements.yaml.
// Usage: node scripts/cv-evidence.ts <slug> [--json]
import type { RequirementEvidence } from './lib/cv-evidence.ts'
import { EXIT, hasErrors, printProblems } from './lib/problem.ts'
import { type Command, openWorkspace } from './lib/workspace.ts'

const printEvidence = (evidence: RequirementEvidence[]) => {
  for (const r of evidence) {
    console.log(`\n${r.id} [${r.kind}${r.competency ? `: ${r.competency}` : ''}] ${r.quote}`)
    if (r.stack) {
      console.log(
        `  stack: matched ${r.stack.matched.join(', ') || 'none'}; missing ${r.stack.missing.join(', ') || 'none'}`,
      )
    }
    if (r.candidates.length === 0) console.log('  no candidates')
    for (const c of r.candidates) {
      console.log(`  ${String(c.score).padStart(2)}  ${c.ref}  (${c.why.join('; ')})`)
      if (c.summary) console.log(`      ${c.summary.slice(0, 160)}`)
    }
  }
}

export const cvEvidence: Command = (args, workspace) => {
  const slug = args.find((a) => !a.startsWith('--'))
  if (!slug) {
    console.error('usage: node scripts/cv-evidence.ts <slug> [--json]')
    return EXIT.usage
  }
  const { problems, evidence } = workspace.roleCv(slug).evidence()
  if (hasErrors(problems)) {
    printProblems(problems, true)
    return EXIT.problems
  }

  if (args.includes('--json')) console.log(JSON.stringify(evidence, null, 2))
  else printEvidence(evidence)
  return 0
}

if (import.meta.main) process.exitCode = await cvEvidence(process.argv.slice(2), openWorkspace())
