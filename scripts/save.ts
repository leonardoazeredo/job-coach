// Saves the user's data (profile/, cv/, pipeline/, experience-bank/) into this folder's history
// and backs it up to the online copy, unless that copy is the engine, or is on GitHub and GitHub
// answers that it is public or cannot be asked.
// Usage: node scripts/save.ts [--everything] "<message>"
// --everything saves every change in the folder, not only the data folders.
// Prints one line for the coach to put in plain words; a refusal or failed backup adds the
// tool's output on stderr. Exit 64 without a message. Exit 1 when the save was refused (the data
// stays written but unsaved) or the online backup failed. Otherwise 0, including when the folder
// keeps no history and nothing is saved.
import { EXIT } from './lib/problem.ts'
import { type Online, type SaveOptions, save } from './lib/save.ts'
import { repoRoot } from './lib/workspace.ts'

const SAVED: Record<Online, string> = {
  pushed: 'saved; backed up online',
  'no-copy': 'saved on this computer',
  public: 'saved on this computer; the online copy is public, so nothing was sent to it',
  unchecked: 'saved on this computer; the online backup waits until the copy is confirmed private',
  failed: 'saved on this computer; the online backup failed',
}

export const saveCommand = async (
  args: string[],
  root: string,
  deps: Omit<SaveOptions, 'message' | 'everything'> = {},
): Promise<number> => {
  const everything = args.includes('--everything')
  const message = args
    .filter((a) => a !== '--everything')
    .join(' ')
    .trim()
  if (!message) {
    console.error('usage: node scripts/save.ts [--everything] "<message>"')
    return EXIT.usage
  }
  const result = await save(root, { ...deps, message, everything })
  switch (result.kind) {
    case 'no-history':
      console.log('not saved: this folder keeps no history')
      return 0
    case 'nothing':
      console.log('nothing new to save')
      return 0
    case 'refused':
      console.log('not saved: a check refused the save')
      console.error(result.output)
      return EXIT.problems
    case 'saved':
      console.log(SAVED[result.online])
      if (result.online !== 'failed') return 0
      console.error(result.output)
      return EXIT.problems
  }
}

if (import.meta.main) process.exitCode = await saveCommand(process.argv.slice(2), repoRoot())
