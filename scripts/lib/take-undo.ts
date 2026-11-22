// Puts a take back as it was when one of its steps fails. The index is saved as the bytes of its
// file, because git cannot list a path's unmerged stages in a form one call restores without
// input, and each file at the paths given is saved with its bytes and mode.
import {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
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

const LOCK_TRIES = 5
const LOCK_WAIT_MS = 250

// Creates the lock holding the new index. Only a lock another program holds is waited for: a
// failure to write is thrown at once, after removing the lock this call created.
const takeLock = (lock: string, bytes: Buffer) => {
  for (let tried = 1; ; tried++) {
    let fd: number
    try {
      fd = openSync(lock, 'wx')
    } catch (error) {
      const held = (error as NodeJS.ErrnoException).code === 'EEXIST'
      if (!held || tried === LOCK_TRIES) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS)
      continue
    }
    try {
      writeFileSync(fd, bytes)
      closeSync(fd)
    } catch (error) {
      try {
        closeSync(fd)
      } catch {
        // Closing is only for the descriptor; whether it works or not, the lock must go.
      }
      rmSync(lock, { force: true })
      throw error
    }
    return
  }
}

// The index file is replaced the way git replaces it, through its lock. A program that holds the
// lock for a moment, such as an editor's git panel refreshing, is waited for over about a second;
// a lock still held after that stops the restore instead of being overwritten.
const putBackIndex = (indexFile: string, bytes: Buffer) => {
  const lock = `${indexFile}.lock`
  takeLock(lock, bytes)
  try {
    renameSync(lock, indexFile)
  } catch (error) {
    rmSync(lock, { force: true })
    throw error
  }
}

// What `restore` names when the index could not be put back; the skill says it to the user in
// these words.
export const INDEX_RECORD = 'the record of which files this update has settled'

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
        failed.push(INDEX_RECORD)
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
