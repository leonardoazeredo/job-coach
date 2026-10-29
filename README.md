# Job coach

A job-search coach for one person, run in Claude Code. It reads your CV and targets, vets job ads, tracks every application, builds a tailored CV per role and prepares you for interviews. Everything it knows lives in plain files in your own repository.

**Your copy will hold your CV, profile and applications. Keep it private.**

## Prerequisites

Required:

- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview)
- Node 24.11 or later in the 24 line, or Node 26 or later (not 25). With nvm or fnm, `nvm use` or `fnm use` picks the version in `.nvmrc`; Homebrew's `node` or the nodejs.org installer works too.
- git, on macOS or Linux. On Windows, use WSL.

Optional:

- The `gh` CLI: onboarding uses it to confirm that your repository is private.
- Chrome or Chromium and poppler, for PDF export (see [Per-role CV export](#per-role-cv-export)).

## Getting started

1. On GitHub, choose **Use this template** and create a **private** repository.
2. Clone it and run `npm ci` in it. The scripts the coach runs (the record checker, the board, the CV tools) need its dependencies.
3. Open the folder in Claude Code and send any first message. A fresh copy has no `profile/coach.md`, so `CLAUDE.md` starts the `onboarding` skill: prerequisites and repo privacy, CV import, identity and targets, then wins, voice, a competency pack and optional sensitive sections, then a final check. Every file is shown to you and written only after your yes. Steps 1, 2, 3 and 8 (the final check) are required; the rest can wait.
4. Later, `node scripts/board.ts` lists any onboarding section still unfinished, and `/onboarding` reruns one section, showing a diff before it overwrites anything.

Cloned `leonardoazeredo/job-coach` directly instead? Run `git remote rename origin upstream`, then point `origin` at a private repository of your own, or keep the copy local. Onboarding checks this too.

After onboarding, paste a job ad to start tracking a role, or ask for your board.

To take later engine updates, see [docs/updating.md](docs/updating.md). Engine bugs and ideas go to the issue tracker on `leonardoazeredo/job-coach` ([CONTRIBUTING.md](CONTRIBUTING.md)). MIT licensed ([LICENSE](LICENSE)).

## Layout

The engine (scripts, skills, config defaults, schemas, docs) is shared upstream. Your own data folders are never part of it, and a fresh copy does not have them: onboarding and the coach create them.

```
CLAUDE.md                  core prompt, always loaded
.claude/skills/<name>/     one skill per task, onboarding included (16)
templates/                 commented *.example.* files onboarding copies into profile/ and cv/
config/rules.yaml          engine defaults: staleness, statuses, events and board groups
config/competencies/<pack>.yaml   competencies an ad can ask for, evidence slots, interview questions
config/cv.yaml             wording rules the CV lint enforces
scripts/check.ts           validates every pipeline folder against the rules and profile files
scripts/board.ts           computes the pipeline board
scripts/cv-*.ts            per-role CV: evidence search, build, provenance lint, PDF export
docs/cv-for-role.md        how per-role CVs are built, and the research behind it
examples/                  a fictional user, for tests and for seeing finished files

Created by onboarding and the coach:
profile/                   coach, identity, search (tiers, fit thresholds, location rule), stack, history, wins, voice, standard answers, lessons
profile/history-private.yaml  private facts about past roles; read only by interview-prep and offer-review
cv/master.json             CV source
pipeline/<slug>/           one folder per tracked role (see pipeline/README.md)
experience-bank/           recorded Q&A per past role
```

## Commands

The coach runs these itself; they are listed for when you want to look.

```
npm run pipeline:board                  # the board; add -- --today=YYYY-MM-DD or -- --json
npm run pipeline:check                  # checks every record; needs onboarding first
npm run examples:check                  # the same check on the fictional example (4 warnings are expected)
node scripts/cv-export.ts <slug>        # print a role's CV to a verified PDF (optional, see below)
```

Job-board discovery scripts and development commands are in [CONTRIBUTING.md](CONTRIBUTING.md); notes on each board are in [docs/boards/](docs/boards/).

## Ground rules

- Facts come from files, never from chat memory.
- `profile/` changes only with your yes; pipeline files are written on every event.
- Metrics are quoted exactly from `profile/wins.yaml`.

## Per-role CV export

PDF export is optional: everything else in the pipeline works without it. `scripts/cv-export.ts` prints the role's CV with the exporter in `scripts/cv-pdf/` (a Vite build of the CV page, printed by headless Chrome, then checked with poppler, pdf.js and mupdf). It needs:

- Chrome or Chromium. It is found at the usual macOS and Linux paths, then in the Playwright browser cache. Set `CHROME_PATH` to the executable to override that.
- poppler (`pdftotext`, `pdfinfo`): `brew install poppler` on macOS, `apt install poppler-utils` on Debian or Ubuntu.

Without either, the command exits 66 and says what to install. Generated PDFs stay out of git.
