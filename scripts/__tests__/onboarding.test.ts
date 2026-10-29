import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { board } from '../board.ts'
import { type TempRepo, tempRepo } from './temp-repo.ts'

let repo: TempRepo
beforeEach(() => {
  repo = tempRepo()
})
afterEach(() => repo.dispose())

const unfinished = () =>
  repo
    .workspace()
    .onboarding()
    .map((s) => s.id)

const removeProfile = () => {
  for (const f of ['profile', 'cv/master.json', 'experience-bank']) repo.remove(f)
}

describe('onboarding status', () => {
  it('has only the opt-in section left for a complete profile', () => {
    // The persona has no history-private.yaml: that section is opt-in, so it stays listed.
    expect(unfinished()).toEqual(['sensitive'])
  })

  it('lists a section whose file is missing, required ones flagged', () => {
    repo.remove('profile/voice.md')
    repo.remove('profile/coach.md')
    const sections = repo.workspace().onboarding()
    expect(sections.find((s) => s.id === 'voice')).toMatchObject({
      required: false,
      missing: ['profile/voice.md'],
    })
    expect(sections.find((s) => s.id === 'identity')).toMatchObject({
      required: true,
      missing: ['profile/coach.md'],
    })
  })

  it('counts a file with template placeholder text as unfinished', () => {
    repo.write('profile/wins.yaml', 'wins: []\n# CHANGE_ME\n')
    expect(
      repo
        .workspace()
        .onboarding()
        .find((s) => s.id === 'wins'),
    ).toMatchObject({ missing: [], placeholders: ['profile/wins.yaml'] })
  })

  it('follows the competency pack named in identity.yaml', () => {
    repo.remove('config/competencies/backend.yaml')
    expect(unfinished()).toContain('competency-pack')
  })

  it('works with no profile at all', () => {
    removeProfile()
    const required = repo
      .workspace()
      .onboarding()
      .filter((s) => s.required)
      .map((s) => s.id)
    expect(required).toEqual(['cv-import', 'identity'])
  })
})

describe('board with onboarding unfinished', () => {
  it('lists the sections under the board', async () => {
    repo.remove('profile/voice.md')
    const run = await repo.run(board, '--today=2026-10-22')
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('## Onboarding unfinished')
    expect(run.stdout).toContain('voice')
  })

  it('prints no onboarding block when only opt-in sections are left', async () => {
    const run = await repo.run(board, '--today=2026-10-22')
    expect(run.stdout).not.toContain('Onboarding unfinished')
  })

  it('does not crash with no profile: lists the sections and exits 0', async () => {
    removeProfile()
    const run = await repo.run(board)
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('Onboarding unfinished')
    expect(run.stdout).toContain('identity')
  })

  it('still reports an unreadable timezone when only unrelated required files are missing', async () => {
    repo.remove('profile/history.yaml')
    repo.write('profile/identity.yaml', 'name: Dana Okafor\nlocation:\n  timezone: Mars/Olympus\n')
    const run = await repo.run(board)
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('"Mars/Olympus" is not a timezone')
  })

  it('adds the sections to the JSON board', async () => {
    repo.remove('profile/voice.md')
    const run = await repo.run(board, '--today=2026-10-22', '--json')
    expect(JSON.parse(run.stdout).onboarding.map((s: { id: string }) => s.id)).toContain('voice')
  })
})
