import { spawnSync } from 'node:child_process'
import {
  chmodSync,
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
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { MakeAdapter } from '../../examples/live-run/replay.ts'
import { scoreFindings } from '../../examples/live-run/score.ts'
import { repoRoot } from '../lib/workspace.ts'
import {
  draftLines,
  fakeAdapter,
  fakeBin,
  installPackages,
  makeRun,
  runReplay,
  writeTurnOutputs,
} from './live-run-replay-fixture.ts'

// The replay's own rules, with the fake adapter standing in for docker, up.sh and turn.sh.
const tmp = mkdtempSync(join(tmpdir(), 'replay-seam-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
let run = ''
beforeEach(() => {
  rmSync(join(tmp, 'run'), { recursive: true, force: true })
  run = makeRun(tmp)
})

describe('the replay loop', () => {
  it('stops before the sample that would start at the budget, and says what was spent', () => {
    const r = runReplay([run, '3', '5'], { LIVE_RUN_BUDGET_USD: '0.25' }, fakeAdapter())
    expect(r.code).toBe(0)
    expect(r.out).toContain('STOP: 0.300 spent, the stop is 0.25. 2 samples were not run.')
    expect(
      r.out.some((l) =>
        l.includes('over 3 replies (spend 0.300 USD, cache tokens read 15, written 21'),
      ),
    ).toBe(true)
  })

  it('stops when the spend equals the budget, and runs on when it is under it', () => {
    // 0.1 + 0.1 is exactly 0.2 in floating point, so the second sample ends at the budget itself.
    const at = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '0.2' }, fakeAdapter())
    expect(at.out).toContain('STOP: 0.200 spent, the stop is 0.2. 1 samples were not run.')
    const under = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '0.21' }, fakeAdapter())
    expect(under.out.some((l) => l.startsWith('STOP:'))).toBe(false)
    expect(under.out.some((l) => l.includes('over 3 replies'))).toBe(true)
  })

  it('exits with a problem and still prints the samples done when preparing a sample throws', () => {
    const inner = fakeAdapter()
    const adapter: MakeAdapter = (job) => {
      const a = inner(job)
      return {
        ...a,
        runSample: (sample) => {
          const r = a.runSample(sample)
          rmSync(join(job.run, 'snap', 'before3.tgz'))
          return r
        },
      }
    }
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err.some((l) => l.startsWith('sample 2 failed: could not unpack the snapshot'))).toBe(
      true,
    )
    expect(r.out.some((l) => l.includes('over 1 replies (spend 0.100 USD'))).toBe(true)
  })

  it('exits with a problem when a sample fails after others were done, and still prints those', () => {
    const adapter = fakeAdapter({ failAt: { sample: 2, spend: 0, failure: 'no container' } })
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('sample 2 failed: no container')
    expect(r.out.some((l) => l.includes('over 1 replies (spend 0.100 USD'))).toBe(true)
  })

  it('counts what a failed sample spent in the total it prints', () => {
    const adapter = fakeAdapter({ failAt: { sample: 2, spend: 0.2, failure: 'budget' } })
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('sample 2 failed: budget (0.200 USD already spent)')
    expect(r.out.some((l) => l.includes('(spend 0.300 USD'))).toBe(true)
  })

  it('exits with a problem and prints no results when the first sample fails', () => {
    const adapter = fakeAdapter({ failAt: { sample: 1, spend: 0, failure: 'no container' } })
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('sample 1 failed: no container')
    expect(r.out.some((l) => l.includes('Fail rate'))).toBe(false)
  })

  it('says why the image did not build and runs no sample', () => {
    let ran = 0
    const adapter = () => ({
      build: () => 'no daemon',
      runSample: () => {
        ran++
        return { spend: 0 }
      },
    })
    const r = runReplay([run, '3', '3'], {}, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('the image did not build; is Docker running? no daemon')
    expect(ran).toBe(0)
  })
})

const foldersPrinted = (out: string[]) => {
  const line = out.find((l) => l.trim().startsWith('Samples are in '))?.trim() ?? ''
  const m = /^Samples are in (.+) \((\d+(?:\.\d)? (?:KB|MB|GB)|\d+ KB)\)$/.exec(line)
  if (!m) throw new Error(`no folder line in: ${line}`)
  return { folder: m[1] as string, size: m[2] as string }
}
const firstSample = (folder: string) => join(folder, `${folder.split('/').pop()}-s1`)

describe('what a replay keeps of each sample', () => {
  it('keeps what the scorer and a reader open and drops the working copy', () => {
    run = makeRun(tmp, { engine: true })
    const r = runReplay([run, '3', '1'], {}, fakeAdapter())
    const sample = firstSample(foldersPrinted(r.out).folder)
    // prepareReplaySample copies the update run's engine in, so only the trim can drop it.
    expect(readdirSync(sample).sort()).toEqual([
      'copy',
      'costlog.txt',
      'kind',
      'last.txt',
      'raw',
      'reply.txt',
      'session.id',
      'transcript.md',
    ])
    expect(readdirSync(join(sample, 'raw')).sort()).toEqual([
      'reply3.txt',
      'turn1.jsonl',
      'turn2.jsonl',
      'turn3.jsonl',
    ])
    // Kept for a person reading a sample later, who wants the files the coach had; the scorer does
    // not open it.
    expect(readFileSync(join(sample, 'copy', 'CLAUDE.md'), 'utf8')).toBe(
      readFileSync(join(repoRoot(), 'CLAUDE.md'), 'utf8'),
    )
    expect(existsSync(join(sample, 'copy', 'node_modules'))).toBe(false)
    for (const gone of ['claudehome', 'cachehome', 'tmpd', 'engine'])
      expect(existsSync(join(sample, gone)), gone).toBe(false)
  })

  it('scores a kept sample to the rows it had before it was trimmed', () => {
    const before: string[][] = []
    const inner = fakeAdapter()
    const adapter: MakeAdapter = (job) => {
      const a = inner(job)
      return {
        ...a,
        runSample: (sample) => {
          const r = a.runSample(sample)
          before.push(scoreFindings(sample).map((x) => JSON.stringify(x)))
          return r
        },
      }
    }
    const r = runReplay([run, '3', '1'], {}, adapter)
    const after = scoreFindings(firstSample(foldersPrinted(r.out).folder)).map((x) =>
      JSON.stringify(x),
    )
    expect(before[0]?.length).toBeGreaterThan(0)
    expect(after).toEqual(before[0])
  })

  it('scores a kept sample that drafted a file to the rows it had before the trim', () => {
    const before: string[][] = []
    const summary = 'Title: Transport Planner\nCity: Leeds'
    const adapter: MakeAdapter = () => ({
      build: () => undefined,
      runSample: (sample) => {
        installPackages(sample)
        writeTurnOutputs(sample, 3, 0.85, draftLines('profile/identity.yaml', summary))
        before.push(scoreFindings(sample).map((x) => JSON.stringify(x)))
        return { spend: 0.1 }
      },
    })
    const r = runReplay([run, '3', '1'], {}, adapter)
    const after = scoreFindings(firstSample(foldersPrinted(r.out).folder)).map((x) =>
      JSON.stringify(x),
    )
    // The reply never relays the summary, so the row exists only if the stream's draft was read.
    expect(before[0]?.some((x) => x.includes('Title: Transport Planner'))).toBe(true)
    expect(after).toEqual(before[0])
  })

  it.each(['kill -INT $$', 'exit 130'])(
    'runs no turn when a preparation step dies of Ctrl-C (%s), and trims the sample',
    (death) => {
      const bin = fakeBin(tmp, 'chmod', death)
      let started = 0
      const adapter: MakeAdapter = () => ({
        build: () => undefined,
        runSample: () => {
          started++
          return { spend: 0.1 }
        },
      })
      const r = runReplay([run, '3', '3'], { PATH: `${bin}:${process.env.PATH}` }, adapter)
      expect(r.code).toBe(130)
      expect(started).toBe(0)
      expect(r.err).toContain('sample 1 failed: interrupted before the turn ran')
      const { folder } = foldersPrinted(r.out)
      expect(readdirSync(folder)).toEqual([`${folder.split('/').pop()}-s1`])
      expect(existsSync(join(firstSample(folder), 'claudehome'))).toBe(false)
      expect(existsSync(join(firstSample(folder), 'raw'))).toBe(true)
    },
  )

  it.each(['kill -INT $$', 'exit 130'])(
    'runs no turn when unpacking the snapshot dies of Ctrl-C (%s), and trims the sample',
    (death) => {
      const bin = fakeBin(tmp, 'tar', death)
      let started = 0
      const adapter: MakeAdapter = () => ({
        build: () => undefined,
        runSample: () => {
          started++
          return { spend: 0.1 }
        },
      })
      const r = runReplay([run, '3', '3'], { PATH: `${bin}:${process.env.PATH}` }, adapter)
      expect(r.code).toBe(130)
      expect(started).toBe(0)
      const { folder } = foldersPrinted(r.out)
      expect(readdirSync(folder)).toEqual([`${folder.split('/').pop()}-s1`])
      expect(existsSync(join(firstSample(folder), 'claudehome'))).toBe(false)
    },
  )

  it.each(['kill -INT $$', 'exit 130'])(
    'runs no turn when the commit of the wording dies of Ctrl-C (%s)',
    (death) => {
      const git = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
      const bin = fakeBin(
        tmp,
        'git',
        `case "$*" in *' commit '*) ${death};; esac\nexec ${git} "$@"`,
      )
      let started = 0
      const adapter: MakeAdapter = () => ({
        build: () => undefined,
        runSample: () => {
          started++
          return { spend: 0.1 }
        },
      })
      const r = runReplay([run, '3', '3'], { PATH: `${bin}:${process.env.PATH}` }, adapter)
      expect(r.code).toBe(130)
      expect(started).toBe(0)
    },
  )

  it('trims a sample whose preparation throws after the unpack', () => {
    const git = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
    const bin = fakeBin(
      tmp,
      'git',
      `case "$*" in *' status '*) mkdir -p "$2/node_modules/pkg"; echo boom >&2; exit 1;; esac\nexec ${git} "$@"`,
    )
    const r = runReplay([run, '3', '1'], { PATH: `${bin}:${process.env.PATH}` }, fakeAdapter())
    expect(r.code).toBe(1)
    expect(r.err.join('\n')).toContain('could not read the wording under test: boom')
    const sample = firstSample(foldersPrinted(r.out).folder)
    for (const gone of ['claudehome', 'snap', 'tmpd', join('copy', 'node_modules')])
      expect(existsSync(join(sample, gone)), gone).toBe(false)
    expect(existsSync(join(sample, 'raw'))).toBe(true)
  })

  it('holds a handler during the replay and removes it after, also when the replay throws', () => {
    const before = process.listenerCount('SIGINT')
    let during = 0
    runReplay([run, '3', '1'], {}, () => ({
      build: () => undefined,
      runSample: (sample) => {
        during = process.listenerCount('SIGINT')
        installPackages(sample)
        writeTurnOutputs(sample, 3, 0.85)
        return { spend: 0.1 }
      },
    }))
    expect(during).toBe(before + 1)
    expect(process.listenerCount('SIGINT')).toBe(before)
    expect(() =>
      runReplay([run, '3', '1'], {}, () => {
        throw new Error('no adapter')
      }),
    ).toThrow('no adapter')
    expect(process.listenerCount('SIGINT')).toBe(before)
    expect(() =>
      runReplay([run, '3', '1'], {}, () => ({
        build: () => {
          throw new Error('no build')
        },
        runSample: () => ({ spend: 0 }),
      })),
    ).toThrow('no build')
    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  it('says it could not trim and still counts a good sample as good', () => {
    let kept = ''
    const adapter: MakeAdapter = ({ turn }) => ({
      build: () => undefined,
      runSample: (sample) => {
        installPackages(sample)
        writeTurnOutputs(sample, turn, 0.85)
        kept = join(sample, 'copy', 'node_modules')
        chmodSync(kept, 0o500)
        return { spend: 0.1 }
      },
    })
    try {
      const r = runReplay([run, '3', '1'], {}, adapter)
      expect(r.code).toBe(0)
      expect(r.err.some((l) => l.startsWith('could not trim '))).toBe(true)
      expect(r.out.some((l) => l.includes('over 1 replies'))).toBe(true)
    } finally {
      chmodSync(kept, 0o700)
    }
  })

  it('refuses an --out whose last part Docker would not take as a container name, before any sample', () => {
    const refused = ['t38 try', '.hidden', '_x', '-x', 'a/b c', 'x:y']
    for (const name of refused) {
      let built = 0
      const adapter: MakeAdapter = () => ({
        build: () => {
          built++
        },
        runSample: () => ({ spend: 0 }),
      })
      const out = join(tmp, 'outs', name)
      const r = runReplay([run, '3', '1', '--out', out], {}, adapter)
      expect(r.code, name).toBe(64)
      expect(built, name).toBe(0)
      expect(existsSync(out), name).toBe(false)
      expect(r.err.join('\n'), name).toContain('letters, digits, _, . and -')
    }
    for (const name of ['t38', 'T38_try.2', '9-a', 'a']) {
      const r = runReplay([run, '3', '1', '--out', join(tmp, 'outs', name)], {}, fakeAdapter())
      expect(r.code, name).toBe(0)
    }
  })

  it('trims a sample that failed, and one that threw, and leaves the reason it failed', () => {
    const failed = runReplay(
      [run, '3', '1'],
      {},
      fakeAdapter({ failAt: { sample: 1, spend: 0, failure: 'no container' } }),
    )
    const sample = firstSample(foldersPrinted(failed.out).folder)
    expect(existsSync(join(sample, 'copy', 'node_modules'))).toBe(false)
    expect(existsSync(join(sample, 'claudehome'))).toBe(false)
    expect(existsSync(join(sample, 'raw', 'turn2.jsonl'))).toBe(true)

    const thrown = runReplay([run, '3', '1'], {}, () => ({
      build: () => undefined,
      runSample: (s) => {
        installPackages(s)
        throw new Error('boom')
      },
    }))
    expect(thrown.err).toContain('sample 1 failed: boom')
    const kept = firstSample(foldersPrinted(thrown.out).folder)
    expect(existsSync(join(kept, 'copy', 'node_modules'))).toBe(false)
  })
})

describe('where the samples go', () => {
  it('puts them under the run folder when no place is named, and prints the folder and its size', () => {
    const r = runReplay([run, '3', '1'], {}, fakeAdapter())
    const { folder, size } = foldersPrinted(r.out)
    expect(folder.startsWith(join(run, 'replays', 'replay-t3-'))).toBe(true)
    expect(size).toMatch(/^\d+ KB$/)
    // The packages the fixture installs are over 1 MB; a size this small is the trimmed one.
    expect(Number.parseInt(size, 10)).toBeLessThan(1024)
    expect(r.out.at(-1)).toBe(`\nSamples are in ${folder} (${size})`)
  })

  it('puts them where --out names, before or after the other arguments', () => {
    const named = join(tmp, 'named', 'here')
    const r = runReplay([run, '3', '1', '--out', named], {}, fakeAdapter())
    expect(foldersPrinted(r.out).folder).toBe(named)
    expect(existsSync(join(named, 'here-s1', 'raw', 'turn3.jsonl'))).toBe(true)
    expect(existsSync(join(run, 'replays'))).toBe(false)
    const second = join(tmp, 'named2')
    const r2 = runReplay(['--out', second, run, '3', '1'], {}, fakeAdapter())
    expect(foldersPrinted(r2.out).folder).toBe(second)
  })

  it('refuses a folder that already holds something, and an --out with no folder, before any sample', () => {
    const full = join(tmp, 'full')
    mkdirSync(full)
    writeFileSync(join(full, 'old.txt'), 'x')
    let ran = 0
    const counting = () => ({
      build: () => undefined,
      runSample: () => {
        ran++
        return { spend: 0 }
      },
    })
    const r = runReplay([run, '3', '1', '--out', full], {}, counting)
    expect(r.code).toBe(64)
    expect(r.err.join('\n')).toContain('already holds something')
    expect(readdirSync(full)).toEqual(['old.txt'])
    expect(runReplay([run, '3', '--out'], {}, counting).code).toBe(64)
    expect(ran).toBe(0)
    const file = join(tmp, 'a-file')
    writeFileSync(file, 'x')
    const onFile = runReplay([run, '3', '1', '--out', file], {}, counting)
    expect(onFile.code).toBe(64)
    expect(onFile.err.join('\n')).toContain('already holds something')
    expect(readFileSync(file, 'utf8')).toBe('x')
    expect(ran).toBe(0)
    const empty = join(tmp, 'empty')
    mkdirSync(empty)
    expect(runReplay([run, '3', '1', '--out', empty], {}, fakeAdapter()).code).toBe(0)
  })
})
