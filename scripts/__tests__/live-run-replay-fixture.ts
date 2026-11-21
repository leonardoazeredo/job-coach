// Fixtures for replaying a turn without Docker or money: a saved run, a way to call replayCommand
// with the environment it reads and its output captured, a docker stand-in for the real adapter
// (real up.sh and turn.sh run against it) and a fake adapter for the replay's own rules.

import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import {
  type MakeAdapter,
  replayCommand,
  type SampleOutcome,
} from '../../examples/live-run/replay.ts'
import { LAYOUT, recordTurn, snapshot } from '../../examples/live-run/run-folder.ts'
import { gitIn } from './live-run-git.ts'

const X_OLD = 'x old body\n'
// The session line claude writes when a skill is loaded, as swap.ts finds it.
export const loadX = (body: string) =>
  JSON.stringify({
    type: 'user',
    isMeta: true,
    message: {
      content: [
        { type: 'text', text: `Base directory for this skill: /w/.claude/skills/x\n\n${body}` },
      ],
    },
  })

export type RunOptions = {
  name?: string
  // Turns recorded, the last of which is the one a replay would redo; 0 leaves an empty run.
  turns?: number
  // An update run's engine folder.
  engine?: boolean
  // A skill the coach loaded, in the copy and in its saved session.
  loadedSkill?: boolean
}

const RUNNING_TOTAL = [0.5, 0.75, 1.5]

// A run built the way a real one is: turns recorded through recordTurn and the snapshot before the
// last of them taken through snapshot. By default three turns, so turn 3 can be replayed; its
// total before the turn is 0.75.
export const makeRun = (tmp: string, opts: RunOptions = {}): string => {
  const { name = 'run', turns = 3 } = opts
  const run = join(tmp, name)
  const { copy, claudehome, raw } = LAYOUT
  mkdirSync(join(run, copy, '.claude', 'skills', 'old'), { recursive: true })
  mkdirSync(join(run, claudehome, 'projects'), { recursive: true })
  mkdirSync(join(run, raw), { recursive: true })
  writeFileSync(join(run, copy, 'CLAUDE.md'), 'old rules\n')
  writeFileSync(join(run, copy, '.claude', 'skills', 'old', 'SKILL.md'), 'old skill\n')
  writeFileSync(join(run, claudehome, 'projects', 's.jsonl'), '{}\n')
  if (opts.loadedSkill) {
    mkdirSync(join(run, copy, '.claude', 'skills', 'x'), { recursive: true })
    writeFileSync(join(run, copy, '.claude', 'skills', 'x', 'SKILL.md'), X_OLD)
    mkdirSync(join(run, claudehome, 'projects', '-w'), { recursive: true })
    writeFileSync(join(run, claudehome, 'projects', '-w', 's.jsonl'), `${loadX(X_OLD)}\n`)
  }
  gitIn(join(run, copy), 'init', '-q', '-b', 'main')
  gitIn(join(run, copy), 'add', '-A')
  gitIn(join(run, copy), 'commit', '-q', '-m', 'first')
  if (opts.engine) {
    mkdirSync(join(run, 'engine'))
    writeFileSync(join(run, 'engine', 'HEAD'), 'ref\n')
  }
  const reply = join(tmp, `${name}-reply.txt`)
  for (let n = 1; n <= turns; n++) {
    // A real stream: an init line that already holds a session id, a line that is not JSON, and a
    // result line that starts with another key and carries `type` further along.
    writeFileSync(
      join(run, raw, `turn${n}.jsonl`),
      `${[
        `{"type":"system","subtype":"init","session_id":"init-sid-${n}"}`,
        'not json at all',
        `{"type":"assistant","message":{"content":[{"type":"text","text":"reply ${n}"}]}}`,
        `{"duration_api_ms":9,"session_id":"sid-${n}","total_cost_usd":${RUNNING_TOTAL[n - 1] ?? n},"type":"result"}`,
      ].join('\n')}\n`,
    )
    writeFileSync(reply, `message ${n}\n`)
    if (n === turns) {
      const failure = snapshot(run, n)
      if (failure !== undefined) throw new Error(failure)
    }
    const recorded = recordTurn(run, n, reply)
    if ('failure' in recorded) throw new Error(recorded.failure)
    // The turn changes the live copy and session after the snapshot, so a sample that matches the
    // snapshot did not come from the live run.
    if (n === turns) {
      writeFileSync(join(run, copy, 'CLAUDE.md'), 'live rules\n')
      appendFileSync(join(run, claudehome, 'projects', 's.jsonl'), '{"turn":"live"}\n')
    }
  }
  return run
}

// What turn.sh leaves in a sample folder for a turn whose running total is `total`: claude's stream
// recorded through the run-folder module, as turn.sh records it. The one place a fake adapter
// writes a turn's outputs.
export const writeTurnOutputs = (
  sample: string,
  turn: number,
  total: number,
  before: string[] = [],
) => {
  const stream = [
    ...before,
    '{"type":"assistant","message":{"content":[{"type":"text","text":"a reply"}]}}',
    `{"type":"result","session_id":"s","total_cost_usd":${total},"usage":{"cache_read_input_tokens":5,"cache_creation_input_tokens":7}}`,
  ]
  writeFileSync(join(sample, 'raw', `turn${turn}.jsonl`), `${stream.join('\n')}\n`)
  const recorded = recordTurn(sample, turn, join(sample, 'reply.txt'))
  if ('failure' in recorded) throw new Error(recorded.failure)
}

// The stream lines of a turn that drafts a profile file and gets the summary back, as the scorer
// reads them from the stream.
export const draftLines = (file: string, summary: string): string[] => [
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 't1', input: { command: `node scripts/profile.ts draft ${file}` } },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: summary }] },
  }),
]

// What the docker adapter's npm ci leaves in a sample: the installed packages, most of its size.
// Over 1 MB, so a size printed before the trim cannot pass for a trimmed one.
export const installPackages = (sample: string) => {
  mkdirSync(join(sample, 'copy', 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(sample, 'copy', 'node_modules', 'pkg', 'index.js'), 'x'.repeat(1_200_000))
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
        if (opts.failAt?.sample === n) {
          installPackages(sample)
          return { spend: opts.failAt.spend, failure: opts.failAt.failure }
        }
        installPackages(sample)
        writeTurnOutputs(sample, turn, 0.85)
        return { spend: 0.1 }
      },
    }
  }

// Calls replayCommand with `env` set for the call, and says what it returned and printed.
export const runReplay = (args: string[], env: Record<string, string>, adapter?: MakeAdapter) => {
  // A budget from the developer's shell must not decide whether these runs pass.
  const base = { CLAUDE_CODE_OAUTH_TOKEN: 'not-a-real-token', LIVE_RUN_BUDGET_USD: '5', ...env }
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
// FAKE_EXTRA_LINES is printed before the reply, FAKE_BUILD=fail and FAKE_RUN=fail fail those commands.
export const dockerStandIn = (dir: string): { bin: string; log: string } => {
  const bin = join(dir, 'bin')
  const log = join(dir, 'docker.log')
  mkdirSync(bin, { recursive: true })
  const script = `#!/bin/bash
echo "$*" >> "${log}"
case "$1" in
  build) [ "$FAKE_BUILD" = fail ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }; exit 0 ;;
  run) [ "$FAKE_RUN" = fail ] && exit 125; exit 0 ;;
  exec) case "$*" in *' npm ci'*) [ "$FAKE_NPM" = fail ] && exit 1; exit 0 ;; esac ;;
  *) exit 0 ;;
esac
N=$(( $(cat "${log}.n" 2>/dev/null || echo 0) + 1 ))
echo $N > "${log}.n"
[ "$N" = "$FAKE_DIE_ON" ] && exit 1
EXTRA=0.1; ERR=false; CODE=0
[ "$N" = "$FAKE_BUDGET_ON" ] && { EXTRA=0.2; ERR=true; CODE=1; }
COST=$(awk -v b="$FAKE_COST_BASE" -v e="$EXTRA" 'BEGIN{printf "%.2f", b+e}')
[ -n "$FAKE_EXTRA_LINES" ] && printf '%s\n' "$FAKE_EXTRA_LINES"
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"a reply"}]}}'
echo '{"type":"result","session_id":"sid-new","is_error":'$ERR',"total_cost_usd":'$COST',"usage":{"cache_read_input_tokens":5,"cache_creation_input_tokens":7}}'
exit $CODE
`
  writeFileSync(join(bin, 'docker'), script)
  chmodSync(join(bin, 'docker'), 0o755)
  return { bin, log }
}
