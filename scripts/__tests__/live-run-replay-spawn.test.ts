import type { SpawnSyncOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// Docker, the container script and the turn script are replaced; tar, chmod and git stay real so
// prepareSample works on a real fixture. No live call is made.
const turnCalls: { budget: string | undefined; sample: string }[] = []
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>()
  const done = () => ({ ...real.spawnSync('true'), status: 0 })
  return {
    ...real,
    spawnSync: (cmd: string, args: string[] = [], opts: SpawnSyncOptions = {}) => {
      if (cmd === 'docker' || cmd.endsWith('/up.sh')) return done()
      if (!cmd.endsWith('/turn.sh')) return real.spawnSync(cmd, args, opts)
      const sample = args[0] ?? ''
      const turn = args[1] ?? ''
      turnCalls.push({ budget: opts.env?.LIVE_RUN_BUDGET_USD, sample })
      const log = readFileSync(join(sample, 'costlog.txt'), 'utf8').trim().split('\n').pop() ?? ''
      const total = Number(log.split(' ')[2]) + 0.1
      writeFileSync(join(sample, 'costlog.txt'), `${log}\nturn ${turn} ${total}\n`)
      writeFileSync(join(sample, 'last.txt'), 'a reply\n')
      writeFileSync(
        join(sample, 'raw', `turn${turn}.jsonl`),
        '{"type":"result","session_id":"s","usage":{"cache_read_input_tokens":5,"cache_creation_input_tokens":7}}\n',
      )
      return done()
    },
  }
})

const { replayCommand } = await import('../../examples/live-run/replay.ts')
const { spawnSync } = await import('node:child_process')

const tmp = mkdtempSync(join(tmpdir(), 'replay-spawn-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const makeRun = () => {
  const run = join(tmp, 'run')
  const stage = join(tmp, 'stage')
  mkdirSync(join(stage, 'copy', '.claude', 'skills'), { recursive: true })
  mkdirSync(join(stage, 'claudehome', 'projects'), { recursive: true })
  writeFileSync(join(stage, 'copy', 'CLAUDE.md'), 'rules\n')
  mkdirSync(join(run, 'snap'), { recursive: true })
  mkdirSync(join(run, 'raw'))
  spawnSync('tar', ['-czf', join(run, 'snap', 'before3.tgz'), '-C', stage, 'copy', 'claudehome'])
  const result = '{"type":"result","session_id":"sid-2","total_cost_usd":0.75}\n'
  writeFileSync(join(run, 'raw', 'turn2.jsonl'), result)
  writeFileSync(join(run, 'raw', 'turn3.jsonl'), result)
  writeFileSync(join(run, 'raw', 'reply3.txt'), 'message 3\n')
  writeFileSync(join(run, 'transcript.md'), '## Turn 1\n\n**Persona:**\n\n> hi\n\n')
  writeFileSync(join(run, 'costlog.txt'), 'turn 1 0.5\nturn 2 0.75\nturn 3 1.5\n')
  return run
}

describe('the replay with a stubbed claude command', () => {
  it('hands every sample the same budget and stops between samples on what they spent', () => {
    const run = makeRun()
    const old = {
      token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      budget: process.env.LIVE_RUN_BUDGET_USD,
    }
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'not-a-real-token'
    process.env.LIVE_RUN_BUDGET_USD = '0.25'
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      expect(replayCommand([run, '3', '5'])).toBe(0)
    } finally {
      const lines = log.mock.calls.map((c) => String(c[0]))
      log.mockRestore()
      for (const [k, v] of [
        ['CLAUDE_CODE_OAUTH_TOKEN', old.token],
        ['LIVE_RUN_BUDGET_USD', old.budget],
      ] as const)
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      // Three samples spend 0.1 each; the fourth would start at 0.3 against a stop of 0.25.
      expect(turnCalls).toHaveLength(3)
      // The run's total before turn 3 (0.75) plus the budget (0.25), the same for every sample.
      expect(turnCalls.map((c) => Number(c.budget))).toEqual([1, 1, 1])
      expect(new Set(turnCalls.map((c) => c.budget)).size).toBe(1)
      expect(lines.some((l) => /cache tokens read 15, written 21/.test(l))).toBe(true)
      expect(lines.some((l) => l.startsWith('STOP:'))).toBe(true)
    }
  })
})
