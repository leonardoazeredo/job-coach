import { lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitIn } from '../lib/history.ts'
import { engineChanges, mergeEngine } from '../lib/update-git.ts'
import { commitAll, g, put, runner, upstream, work } from './update-helpers.ts'

export type Seen = Record<string, string | null>

export const gitOf = () => {
  const git = gitIn(work())
  if (!git) throw new Error('no git')
  return git
}
export const link = (base: string, rel: string, target: string) => {
  g(base, 'rm', '-q', '-f', '--ignore-unmatch', rel)
  mkdirSync(dirname(join(base, rel)), { recursive: true })
  symlinkSync(target, join(base, rel))
}
// A link reads as "-> target", so a test tells it from a file with that text.
export const seen = (rel: string): string | null => {
  const path = join(work(), rel)
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return `-> ${readlinkSync(path)}`
    return stat.isDirectory() ? 'dir' : readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
export const commitUser = (message: string) => commitAll(work(), message)
export const commitEngine = (message: string) => commitAll(upstream(), message)

export const engineWrite = (files: Record<string, string>) => {
  put(upstream(), files)
  commitEngine('New version')
}
export const userLink = (rel: string, target: string) => {
  link(work(), rel, target)
  commitUser('Saved: link')
}
export const engineLink = (rel: string, target: string) => {
  link(upstream(), rel, target)
  commitEngine('New link')
}
export const engineRemove = (rel: string) => {
  g(upstream(), 'rm', '-q', '-r', rel)
  commitEngine('Drop')
}
export const userRemove = (rel: string) => {
  g(work(), 'rm', '-q', '-r', rel)
  commitUser('Saved: removal')
}
export const start = () => {
  const git = gitOf()
  const url = upstream()
  engineChanges(git, { url })
  return { git, merged: mergeEngine(work(), git, { url, run: runner().run }) }
}
