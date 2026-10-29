// Builds pipeline/<slug>/cv/cv.json (CvData for cv-pdf/) from cv/bullets.yaml,
// and cv/keywords.txt from the requirements.yaml keywords that appear in it. Writes nothing
// while any check (profile, folder, files, requirements, build or lint) reports an error,
// so a CV that fails a check never reaches the PDF export.
// Usage: node scripts/cv-build.ts <slug>
import { EXIT, hasErrors, printProblems } from './lib/problem.ts'
import { type Command, openWorkspace } from './lib/workspace.ts'

export const cvBuild: Command = (args, workspace) => {
  const slug = args[0]
  if (!slug) {
    console.error('usage: node scripts/cv-build.ts <slug>')
    return EXIT.usage
  }
  const rc = workspace.roleCv(slug)
  const problems = rc.write()
  printProblems(problems, true)
  if (hasErrors(problems)) {
    console.error('cv-build: not written; fix the errors above')
    return EXIT.problems
  }
  console.log(
    `cv-build: wrote pipeline/${slug}/cv/cv.json and keywords.txt (${rc.keywords.length} keywords)`,
  )
  return 0
}

if (import.meta.main) process.exitCode = await cvBuild(process.argv.slice(2), openWorkspace())
