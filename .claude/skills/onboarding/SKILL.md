---
name: onboarding
description: Set up or update the user's profile, CV source, search targets and voice. Use when profile/coach.md is missing (CLAUDE.md sends every first session here), when the user runs /onboarding, or when node scripts/board.ts lists unfinished onboarding sections.
---

# Onboarding

Collect the data the engine was published without, one section at a time, and write it only with the user's yes. The files are the memory: this skill's state is which files exist and what is still in them.

## Read first

- `node scripts/board.ts`: prints "Onboarding unfinished" with each section's id, whether it is required, and the file that is missing or still holds `CHANGE_ME`. A section absent from that list is done.
- `templates/profile/*.example.*` and `templates/cv/master.example.json`: one template per file, with a comment on every field. Start every file from its template; the persona under `examples/austin-backend/` shows a filled one.
- `config/competencies/`: the packs that exist.

## Rules for every step

- Show each file in full, then write it only after the user says yes. A no or a correction loops back to showing the file again; the step is done when the file is written or the user defers it.
- The user's pasted CV, LinkedIn text or PDF is the source for this session. A value the source does not hold is asked, never inferred: one specific question at a time.
- Strip the template's explanatory comments when writing the file; keep the short ones that tell a later reader why a value is what it is. No `CHANGE_ME` survives in a finished file, comments included: the board counts the token anywhere, so the template header that names it goes too.
- Required steps are 1, 2, 3 and 8. Offer to defer each of 4 to 7: a deferral is one line to the user ("the board will list it") and changes no file.
- A file that already exists is updated, never replaced: see Re-runs.

## Re-runs

At the start, run `node scripts/board.ts` and list each section as done, unfinished or never started, then ask which to work on. Before overwriting any existing file, write the proposed text to a scratch path outside the repo and show `diff -u <existing> <proposed>`; the file is replaced only after a yes to that diff. Carry the user's existing values into the proposal, and change only what they asked to change.

## Steps

### 1. Prerequisites and repo privacy

Run these and report each result in one line:

```sh
node --version                      # needs ^24.11 or >=26 (package.json engines)
gh repo view --json visibility -q .visibility
for p in "${CHROME_PATH:-}" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser; do [ -n "$p" ] && [ -x "$p" ] && echo "chrome: $p" && break; done
command -v pdftotext pdfinfo
```

- Node below the range: stop; the user installs a newer Node (`nvm install` reads `.nvmrc`), then reruns.
- Visibility `PUBLIC`: say loudly that profile, CV and pipeline files hold personal data and must not be committed to a public repository. A fork of a public repository cannot be made private, so the user recreates the copy from the template as private; a repository created from the template can be switched with `gh repo edit --visibility private --accept-visibility-change-consequences`. Continue only when the user confirms the repository is, or will be, private. If `gh` cannot tell (not installed, no remote), say so and ask the user to confirm.
- No Chrome or no poppler is a warning, not a stop: PDF export is optional and can be set up later. Give the install command: `brew install --cask google-chrome` and `brew install poppler` on macOS; `sudo apt install chromium poppler-utils` on Debian or Ubuntu; elsewhere set `CHROME_PATH` to a Chrome binary.

Done when Node is in range, visibility is private or confirmed so by the user, and each warning has been shown.

### 2. CV import

Ask: "Paste your CV or LinkedIn text, or give me a PDF path." For a PDF, read it with the Read tool, or with `pdftotext -layout <path> -` when poppler is present.

Draft, from that source only, then show and write one file at a time:

1. `profile/history.yaml` from `templates/profile/history.example.yaml`: one entry per role, newest first, with `id`, `company` and the `public` block. Titles, dates and employment type are the public labels. Ask one question per unclear date or title.
2. `profile/stack.yaml`: core, secondary, past and tools, sorted by depth. Technologies the CV shows only briefly go to `secondary` or `past` with `roles` and `claim_as` limits. Ask whether anything in `do_not_claim` applies: things a recruiter would assume the user does that they do not.
3. `cv/master.json` from `templates/cv/master.example.json` (create `cv/` if needed): bullets reworded only from what the source says, metrics exactly as in the source.
4. `profile/wins.yaml` from `templates/profile/wins.example.yaml`: candidate wins from the bullets, each `status: proposed`, `metric: "Not specified"` unless the source states one, with `# CHANGE_ME: metrics unconfirmed, finish onboarding step 4` as the first line. `check.ts` needs this file to exist, and the marker keeps the board listing step 4 until it is done.

Done when the four files exist and each person-fact in them traces to the pasted source or an answer.

### 3. Identity and targets

Ask in short groups, never all at once: name and pronouns; locale and spelling (`en-GB`, `en-US`) and the language to be coached in; city, timezone and since when; right to work by country; years of professional experience; roles, seniority and discipline; salary floor, currency and levels; remote or hybrid and office days; what a good role has; where to look (regions, titles).

Write, from the templates:

1. `profile/identity.yaml`. Set `competency_pack` to a pack that exists in `config/competencies/`; step 6 changes it if the user wants another.
2. `profile/search.yaml`: three tiers worded with the user's own criteria and currency, a `min_stack_overlap_pct`, a location rule in prose, and the discovery titles and search. The salary floor lives in `identity.yaml` only.
3. `profile/coach.md`: the four bullets, in the user's language and tone. This file is the gate CLAUDE.md checks, so write it last.

Done when the three files exist, `timezone` is an IANA name and `locale` a language tag (the scripts reject others).

### 4. Wins

Take the wins in `profile/wins.yaml` one by one. For each: show the action and the metric, then ask "Is this number right, and is that exactly how you would say it?" Write the metric word for word as the user answers, qualifiers included ("contributed to", "up to"). Ask for `never_say` inflations: the stronger version of the claim that a draft might drift into. A win the user cannot put a metric on keeps `Not specified`. Set `status: approved` only on the user's yes to that win. Add wins the user raises, with `role` matching a `history.yaml` id. When the last win is settled, remove the `CHANGE_ME` marker line.

Done when no win is `proposed` without the user's say-so and the marker is gone.

### 5. Voice

Ask for two or three samples of the user's own writing (an email, a post, a cover note) and, if they like, a spoken answer typed out. Draft `profile/voice.md` from `templates/profile/voice.example.md`: traits seen in the samples, written and spoken registers, words and habits to avoid. Quote a phrase from a sample for each trait so the user can check it.

Done when every trait in the file traces to a sample.

### 6. Competency pack

The pack is the list of competencies an ad can ask for and the evidence a bullet must show. List `config/competencies/`. If one fits the user's discipline, set `competency_pack` to it (a diff on `identity.yaml`). Otherwise draft `config/competencies/<name>.yaml` in the shape of `config/competencies/frontend.yaml`: 8 to 12 competencies, each with `id`, `label`, `ad_words`, `win_themes`, `slots` and one `questions` entry per slot, plus the top-level `themes` list. Use the user's discipline for `ad_words` and the questions; keep the ids that skills refer to (`stakeholder-management`, `technical-leadership`, `system-design`, `mentoring`, `ownership-delivery`, `influence-push-back`, `cross-functional-collaboration`) when they fit. Then set `competency_pack` in `identity.yaml` to the new name, and add `competencies` and `themes` that `wins.yaml` should use.

Done when `competency_pack` names a file that exists and every win's `competencies` and `themes` appear in it.

### 7. Optional sensitive sections

Offer each in one sentence on why it exists, and write it only if the user opts in:

- `profile/history-private.yaml`: facts about past roles that must never reach outward material, such as a payroll title that differs from the public one or a background-check risk. Only interview-prep and offer-review read it.
- `profile/standard-answers.yaml`: answers to the questions every application form asks, so application-writer reuses the user's wording. Salary answers come from `identity.yaml` levels.
- Salary history: kept in `history-private.yaml` per role under `salary_history`, only on request.

Done when each of the three is written or declined.

### 8. Check and next step

1. If `profile/lessons.md` is missing, show `templates/profile/lessons.example.md` and write it on a yes: interview-debrief appends to it.
2. Run `node scripts/check.ts`. Errors name the file; fix that file with the user, through the diff rule, and rerun until it exits 0. Warnings are read out and explained.
3. Run `node scripts/board.ts` and show the "Onboarding unfinished" list, if any, as what remains.
4. End with one suggested next step: "Paste a job ad or a link and I will run job-intake."

Done when `check.ts` exits 0 and the unfinished list holds only sections the user deferred.
