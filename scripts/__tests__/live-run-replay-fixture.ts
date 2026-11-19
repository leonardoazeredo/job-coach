// Fixtures for replaying a turn without Docker or money: a saved run, a way to call replayCommand
// with the environment it reads and its output captured, a docker stand-in for the real adapter
// (real up.sh and turn.sh run against it) and a fake adapter for the replay's own rules.

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import {
  type MakeAdapter,
  replayCommand,
  type SampleOutcome,
} from '../../examples/live-run/replay.ts'

// A run whose turn 3 can be replayed; its total before turn 3 is 0.75.
export const makeRun = (tmp: string): string => {
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

// What turn.sh leaves in a sample folder for a turn whose running total is `total`. The one place a
// fake adapter writes the outputs of turn.sh by hand.
export const writeTurnOutputs = (sample: string, turn: number, total: number) => {
  writeFileSync(
    join(sample, 'costlog.txt'),
    `turn ${turn - 1} ${total - 0.1}\nturn ${turn} ${total}\n`,
  )
  writeFileSync(join(sample, 'last.txt'), 'a reply\n')
  writeFileSync(
    join(sample, 'raw', `turn${turn}.jsonl`),
    '{"type":"result","session_id":"s","usage":{"cache_read_input_tokens":5,"cache_creation_input_tokens":7}}\n',
  )
}

// Spends 0.1 per sample on top of the run's 0.75; `failAt` is the sample that fails, with what it
// had spent by then.
export const fakeAdapter =
  (opts: { failAt?: { sample: number; spend: number; failure: string } } = {}): MakeAdapter =>
  ({ turn }) => {
    let n = 0
    return {
      build: () => undefined,
      runSample: (sample): SampleOutcome => {
        n++
        if (opts.failAt?.sample === n)
          return { spend: opts.failAt.spend, failure: opts.failAt.failure }
        writeTurnOutputs(sample, turn, 0.85)
        return { spend: 0.1 }
      },
    }
  }

// Calls replayCommand with `env` set for the call, and says what it returned and printed.
export const runReplay = (args: string[], env: Record<string, string>, adapter?: MakeAdapter) => {
  const base = { CLAUDE_CODE_OAUTH_TOKEN: 'not-a-real-token', ...env }
  const old = Object.fromEntries(Object.keys(base).map((k) => [k, process.env[k]]))
  Object.assign(process.env, base)
  const out = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const code = replayCommand(args, adapter)
    return {
      code,
      out: out.mock.calls.map((c) => String(c[0])),
      err: err.mock.calls.map((c) => String(c[0])),
    }
  } finally {
    out.mockRestore()
    err.mockRestore()
    for (const [k, v] of Object.entries(old))
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
  }
}

// A `docker` that logs each call to `log`. Its `exec` answers like claude does: one reply and a
// result whose running total is FAKE_COST_BASE plus 0.1. FAKE_DIE_ON=n makes the nth exec exit
// with nothing; FAKE_BUDGET_ON=n makes it spend 0.2, report an error result and exit 1;
// FAKE_BUILD=fail and FAKE_RUN=fail fail those commands.
export const dockerStandIn = (dir: string): { bin: string; log: string } => {
  const bin = join(dir, 'bin')
  const log = join(dir, 'docker.log')
  mkdirSync(bin, { recursive: true })
  const script = `#!/bin/bash
echo "$*" >> "${log}"
case "$1" in
  build) [ "$FAKE_BUILD" = fail ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }; exit 0 ;;
  run) [ "$FAKE_RUN" = fail ] && exit 125; exit 0 ;;
  exec) ;;
  *) exit 0 ;;
esac
N=$(( $(cat "${log}.n" 2>/dev/null || echo 0) + 1 ))
echo $N > "${log}.n"
[ "$N" = "$FAKE_DIE_ON" ] && exit 1
EXTRA=0.1; ERR=false; CODE=0
[ "$N" = "$FAKE_BUDGET_ON" ] && { EXTRA=0.2; ERR=true; CODE=1; }
COST=$(awk -v b="$FAKE_COST_BASE" -v e="$EXTRA" 'BEGIN{printf "%.2f", b+e}')
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"a reply"}]}}'
echo '{"type":"result","session_id":"sid-new","is_error":'$ERR',"total_cost_usd":'$COST',"usage":{"cache_read_input_tokens":5,"cache_creation_input_tokens":7}}'
exit $CODE
`
  writeFileSync(join(bin, 'docker'), script)
  chmodSync(join(bin, 'docker'), 0o755)
  return { bin, log }
}
