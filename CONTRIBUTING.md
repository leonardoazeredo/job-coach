# Contributing

This is the engine for a personal job-search coach. Engine changes (scripts, skills, config defaults, schemas, docs) go upstream to `leonardoazeredo/job-coach`. A user's own data (`profile/`, `pipeline/<slug>/`, `cv/`, `experience-bank/`) is never part of an engine change; see `docs/adr/0007-engine-upstream-user-data-never-shipped.md`.

## Setup and checks

TypeScript scripts run directly on Node (no build step). Biome for lint and format, Vitest for tests, lefthook for git hooks.

```
nvm use                    # Node 26 (.nvmrc)
npm ci
npm run ci                 # biome, tsc, vitest, and check.ts on examples/austin-backend (also runs on pre-push)
node scripts/cv-evidence.ts <slug>   # candidate evidence per requirement
node scripts/cv-lint.ts [<slug>]     # provenance checks (also part of pipeline:check)
node scripts/discovery/pull.ts <rocketship|whatruns> out.json
                                     # pull one job board's listings to a file
node scripts/discovery/shortlist.ts listings.json... [--today=YYYY-MM-DD]
                                     # shortlist saved pulls, writes shortlist.json beside the first
```

Tests run against the fictional persona in `examples/austin-backend`, never against a real user's data.

## For maintainers: agent skills

Engineering skills used when working on the engine read these files. A user of the coach does not need them.

### Issue tracker

Issues live in GitHub Issues on `leonardoazeredo/job-coach`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created only when needed. See `docs/agents/domain.md`.
