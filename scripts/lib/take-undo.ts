// Puts a take back as it was when one of its steps fails. The index is saved as the bytes of its
// file, because git cannot list a path's unmerged stages in a form one call restores without
// input, and each file at the paths given is saved with its bytes and mode.
import {
  chmodSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Git } from './history.ts'

type Held =
  | { path: string; kind: 'none' }
  | { path: string; kind: 'file'; bytes: Buffer; mode: number }
  | { path: string; kind: 'link'; target: string }

const heldAt = (top: string, path: string): Held => {
  const file = join(top, path)
  const stat = lstatSync(file, { throwIfNoEntry: false })
  if (stat?.isSymbolicLink()) return { path, kind: 'link', target: readlinkSync(file) }
  if (stat?.isFile()) {
    return { path, kind: 'file', bytes: readFileSync(file), mode: stat.mode & 0o7777 }
  }
  return { path, kind: 'none' }
}

const unchanged = (top: string, held: Held): boolean => {
  const now = heldAt(top, held.path)
  if (now.kind !== held.kind) return false
  if (now.kind === 'file' && held.kind === 'file')
    return now.mode === held.mode && now.bytes.equals(held.bytes)
  if (now.kind === 'link' && held.kind === 'link') return now.target === held.target
  return true
}

const putBack = (top: string, held: Held) => {
  const file = join(top, held.path)
  rmSync(file, { force: true })
  if (held.kind === 'file') {
    writeFileSync(file, held.bytes)
    chmodSync(file, held.mode)
  } else if (held.kind === 'link') symlinkSync(held.target, file)
}

// The index file is replaced the way git replaces it, through its lock, so a lock another program
// holds stops the restore instead of being overwritten.
const putBackIndex = (indexFile: string, bytes: Buffer) => {
  const lock = `${indexFile}.lock`
  writeFileSync(lock, bytes, { flag: 'wx' })
  try {
    renameSync(lock, indexFile)
  } catch (error) {
    rmSync(lock, { force: true })
    throw error
  }
}

export type TakeUndo = { restore: () => string[] }

// `restore` returns what it could not put back: empty when everything is as it was. A file
// already as it was is left alone, so a read-only folder does not fail the restore of what
// the take never changed.
export const holdTake = (git: Git, top: string, paths: string[]): TakeUndo => {
  const indexFile = git([
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'index',
  ]).stdout.trim()
  const index = readFileSync(indexFile)
  const held = paths.map((path) => heldAt(top, path))
  return {
    restore: () => {
      const failed: string[] = []
      try {
        if (!readFileSync(indexFile).equals(index)) putBackIndex(indexFile, index)
      } catch {
        failed.push('the list of files git keeps')
      }
      for (const one of held) {
        try {
          if (!unchanged(top, one)) putBack(top, one)
        } catch {
          failed.push(one.path)
        }
      }
      return failed
    },
  }
}
