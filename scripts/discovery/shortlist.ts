// Prints the shortlist of saved pulls and writes it, kept and dropped, to
// shortlist.json beside the first pull, so the result outlives the terminal.
// Usage: node scripts/discovery/shortlist.ts listings.json... [--today=YYYY-MM-DD]
// Without --today, today is the day in the timezone in profile/identity.yaml.
// Exit 64 on bad arguments, 66 when a pull is missing, 1 when a pull, that timezone or
// config/rules.yaml cannot be read or the shortlist cannot be written. The rules matter
// because the title expansion and expiry window come from them.
import { dirname, join } from 'node:path'
import { isDay } from '../lib/dates.ts'
import {
  type Dropped,
  readPulls,
  saveShortlist,
  shortlistLine,
  shortlist as shortlistListings,
} from '../lib/listings.ts'
import { EXIT, hasErrors, printProblems } from '../lib/problem.ts'
import { type Command, openWorkspace } from '../lib/workspace.ts'

export const shortlist: Command = (args, workspace) => {
  const todayArg = args.find((a) => a.startsWith('--today='))?.slice('--today='.length)
  const files = args.filter((a) => !a.startsWith('--'))
  if (files.length === 0 || (todayArg !== undefined && !isDay(todayArg))) {
    console.error(
      'usage: node scripts/discovery/shortlist.ts listings.json... [--today=YYYY-MM-DD]',
    )
    return EXIT.usage
  }

  const read = readPulls(files)
  printProblems(read.problems, false)
  if (!read.listings) return read.missing ? EXIT.missing : EXIT.problems
  const listings = read.listings

  const local = workspace.today({ given: todayArg })
  if (!local.today) {
    printProblems(local.problems, true)
    return EXIT.problems
  }
  const today = local.today

  const { discovery, problems } = workspace.discovery()
  printProblems(problems, false)
  if (!discovery) return EXIT.problems
  if (hasErrors(problems)) console.error('listings for these roles may show as new')

  const { kept, dropped } = shortlistListings(listings, discovery, today)

  console.log(
    `${kept.length} shortlisted from ${listings.length} listings in ${files.length} file(s)`,
  )
  for (const [i, l] of kept.entries()) console.log(`${i + 1}. ${shortlistLine(l)}`)

  const count = (reason: Dropped['reason']): number =>
    dropped.filter((d) => d.reason === reason).length
  console.log(`\ndropped: ${count('title')} by title, ${count('expired')} expired`)
  for (const d of dropped.toSorted((a, b) => a.reason.localeCompare(b.reason)))
    console.log(`  ${d.reason.padEnd(7)} ${d.listing.company}: ${d.listing.title}`)

  const outFile = join(dirname(files[0] ?? '.'), 'shortlist.json')
  const unsaved = saveShortlist(outFile, { today, kept, dropped })
  if (unsaved.length > 0) {
    printProblems(unsaved, false)
    return EXIT.problems
  }
  console.log(`\nwritten to ${outFile}`)
  return 0
}

if (import.meta.main) process.exitCode = await shortlist(process.argv.slice(2), openWorkspace())
