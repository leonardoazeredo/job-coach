import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  LAYOUT,
  missingForReplay,
  prepareReplaySample,
  readCost,
  runFolderCommand,
  snapshot,
  snapshotHadPackages,
  transcriptBefore,
  writeCost,
} from '../../examples/live-run/run-folder.ts'
import { EXIT } from '../lib/problem.ts'
import { makeRun } from './live-run-replay-fixture.ts'

const tmp = mkdtempSync(join(tmpdir(), 'run-snapshot-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('the snapshot and the replay sample', () => {
  const read = (...p: string[]) => readFileSync(join(...p), 'utf8')
  // Every file's path and content, so a change, an addition or a removal in the run shows.
  const contents = (dir: string) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name))
      .sort()
      .map((f) => [f, readFileSync(f, 'utf8')])

  it('unpacks a snapshot into a sample that has a run folder’s shape, and leaves the run as it was', () => {
    const run = makeRun(tmp, { name: 'round-trip', engine: true })
    const sample = join(tmp, 'round-trip-sample')
    const before = contents(run)
    prepareReplaySample(run, 3, sample)
    expect(read(sample, 'copy', 'CLAUDE.md')).toBe('old rules\n')
    expect(read(sample, 'claudehome', 'projects', 's.jsonl')).toBe('{}\n')
    for (const d of [LAYOUT.raw, LAYOUT.cachehome, LAYOUT.tmpd])
      expect(existsSync(join(sample, d))).toBe(true)
    expect(read(sample, 'engine', 'HEAD')).toBe('ref\n')
    expect(read(sample, 'kind')).toBe('update\n')
    expect(read(sample, 'transcript.md')).toBe(transcriptBefore(run, 3))
    expect(read(sample, 'transcript.md')).toContain('## Turn 2')
    expect(read(sample, 'transcript.md')).not.toContain('## Turn 3')
    expect(read(sample, 'session.id')).toBe('sid-2')
    expect(read(sample, 'reply.txt')).toBe('message 3\n')
    expect(read(sample, 'costlog.txt')).toBe('turn 2 0.75\n')
    expect(existsSync(join(sample, 'raw', 'turn1.jsonl'))).toBe(true)
    expect(existsSync(join(sample, 'raw', 'turn2.jsonl'))).toBe(true)
    expect(existsSync(join(sample, 'raw', 'turn3.jsonl'))).toBe(false)
    expect(existsSync(join(sample, 'written'))).toBe(false)
    expect(contents(run)).toEqual(before)
    expect(missingForReplay(run, 3)).toEqual([])
    expect(missingForReplay(run, 2)).toContain('snap/before2.tgz')
  })

  it('gives a turn-1 sample no session or cost log, and an empty transcript', () => {
    const run = makeRun(tmp, { name: 'turn-one', turns: 1 })
    const sample = join(tmp, 'turn-one-sample')
    prepareReplaySample(run, 1, sample)
    expect(missingForReplay(run, 1)).toEqual([])
    expect(existsSync(join(sample, 'session.id'))).toBe(false)
    expect(existsSync(join(sample, 'costlog.txt'))).toBe(false)
    expect(read(sample, 'transcript.md')).toBe('')
    expect(read(sample, 'kind')).toBe('onboarding\n')
  })

  it('refuses a previous stream with no result in one plain line', () => {
    const run = makeRun(tmp, { name: 'no-result' })
    writeFileSync(join(run, 'raw', 'turn2.jsonl'), '{"type":"system","session_id":"x"}\n')
    expect(() => prepareReplaySample(run, 3, join(tmp, 'no-result-sample'))).toThrow(
      'raw/turn2.jsonl holds no result with a session id',
    )
  })

  it('leaves node_modules out, and sets the packages marker only while there are some', () => {
    const run = makeRun(tmp, { name: 'packages', turns: 0 })
    mkdirSync(join(run, 'copy', 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(run, 'copy', 'node_modules', 'x', 'i.js'), '')
    expect(snapshot(run, 1)).toBeUndefined()
    const listing = spawnSync('tar', ['-tzf', join(run, 'snap', 'before1.tgz')], {
      encoding: 'utf8',
    })
    expect(listing.stdout).toContain('copy/CLAUDE.md')
    expect(listing.stdout).not.toContain('node_modules')
    expect(snapshotHadPackages(run, 1)).toBe(true)
    rmSync(join(run, 'copy', 'node_modules'), { recursive: true })
    expect(snapshot(run, 1)).toBeUndefined()
    expect(snapshotHadPackages(run, 1)).toBe(false)
  })

  it('says why a snapshot failed, and the command exits 65', () => {
    const run = makeRun(tmp, { name: 'no-home', turns: 0 })
    rmSync(join(run, 'claudehome'), { recursive: true })
    expect(snapshot(run, 1)).toMatch(/^could not snapshot before turn 1: /)
    expect(runFolderCommand(['snapshot', run, '1'])).toBe(EXIT.data)
    expect(runFolderCommand(['snapshot', run])).toBe(EXIT.usage)
  })
})

describe('a finished run’s cost', () => {
  it('writes the cost log’s last total, and reads it back as a number', () => {
    const run = makeRun(tmp, { name: 'cost' })
    expect(writeCost(run)).toBe('total_usd 1.5\n')
    expect(readFileSync(join(run, 'cost.txt'), 'utf8')).toBe('total_usd 1.5\n')
    expect(readCost(run)).toBe(1.5)
  })

  it('reads what is not a number as written, minus backticks', () => {
    const run = makeRun(tmp, { name: 'cost-text', turns: 0 })
    writeFileSync(join(run, 'cost.txt'), 'total_usd n/a\n')
    expect(readCost(run)).toBe('n/a')
    writeFileSync(join(run, 'cost.txt'), 'total_usd `x`\n')
    expect(readCost(run)).toBe('x')
  })

  it('writes nothing when the cost log cannot be read, never a total of 0', () => {
    const run = makeRun(tmp, { name: 'cost-unreadable', turns: 0 })
    mkdirSync(join(run, 'costlog.txt'))
    expect(() => writeCost(run)).toThrow()
    expect(existsSync(join(run, 'cost.txt'))).toBe(false)
  })
})
