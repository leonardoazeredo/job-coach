---
name: onboarding
description: Set up or update the user's profile, CV source, search targets and voice. Use when profile/coach.md is missing (CLAUDE.md sends every first session here), when the user runs /onboarding, or when node scripts/board.ts lists unfinished onboarding sections.
---

# Onboarding

Collect the data the engine was published without, one section at a time, and write it only with the user's yes, through the Draft command. The files are the memory: this skill's state is which files exist and what is still in them.

## Read first

- `node scripts/board.ts`: prints "Onboarding unfinished" with each section's id, whether it is required, and the file that is missing or has wins waiting for a yes. A section absent from that list is done.
- `templates/profile/*.example.*` and `templates/cv/master.example.json`: the keys each file takes, with a comment on every field. The persona under `examples/austin-backend/` shows a filled one.
- `config/competencies/`: the packs that exist.

## Rules for every step

- Every write to `profile/*` or `cv/master.json` goes through `node scripts/profile.ts`, run from the folder's root:
  1. `draft <file>` with the values as JSON on stdin (keys as in the file's template; a markdown file takes its whole text, under the headings its template shows). It prints the summary.
  2. Relay the summary as printed, with at most one framing sentence (Showing a change in CLAUDE.md).
  3. On the user's yes, `write <file>`. A no or a correction goes back to step 1 with the changed values. The step is done when the file is written or the user defers it.
  4. After the section's writes, one `node scripts/save.ts`.
- A draft that is refused names the value it still lacks: ask the user for that value, one question. Pass `null` for it only when the user says there is none. Give the draft only values the user or the source supplied; a key you leave out keeps the template's default.
- The user's pasted CV, LinkedIn text or PDF is the source for this session. A value the source does not hold is asked, never inferred: one specific question at a time. Each reply asks one thing and waits; asking for a yes on a summary counts as that one thing, so a further question waits for the next reply. A value the user gave only in part (a year without a month) is written in the part they gave. The same goes for the location of a job or course: "Bradford" stays "Bradford", and a college's name does not give its location. If the source gives none, pass `null` for it; a CV reads fine without it. The same goes for a course's start date: if the source gives none, pass `null` for `start` and never an empty string.
- Required steps are 1, 2, 3, 6 and 8. Offer to defer each of 4, 5 and 7: a deferral is one line to the user ("It stays on your list for later") and changes no file.
- A file that already exists is updated, never replaced: the input names only the values that change (Re-runs).

## Re-runs

At the start, run `node scripts/board.ts` and list each section as done, unfinished or never started, then ask which to work on. Draft an existing file with only the values the user asked to change: the summary then lists just those, and anything not named stays as it is. Removing a job, win or tool needs an explicit remove entry in the input (`{"remove": "<id>"}` in the list).

## Steps

### 1. Prerequisites and keeping the data private

The user may know nothing about git, GitHub or Node. Run the checks yourself, act on what they show, and talk in plain words (Plain words in CLAUDE.md): "this folder", "this computer", "online", "public" and "private". Ask only what the user can answer.

Run these and keep the results to yourself until a bullet below says what to tell the user:

```sh
node --version                      # needs ^24.11 or >=26 (package.json engines)
# On a Mac without developer tools, plain `git` opens an install dialog; the guard skips it.
if command -v git >/dev/null && { [ "$(uname)" != Darwin ] || xcode-select -p >/dev/null 2>&1; }; then
  git rev-parse --show-toplevel; git remote get-url origin   # no origin: the folder lives only on this computer
else echo "no git"; fi
ls -d "${NVM_DIR:-$HOME/.nvm}" 2>/dev/null; command -v fnm volta brew   # which Node managers exist
for p in "${CHROME_PATH:-}" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser; do [ -n "$p" ] && [ -x "$p" ] && echo "chrome: $p" && break; done
command -v pdftotext pdfinfo
```

For a GitHub `origin` that is not the engine, check it without `gh` or a login: `curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/<owner>/<name>` answers 200 for a public repository and 404 for a private one (or one that does not exist).

- Node missing, or outside the range (Node 25 is outside it too): install or switch it yourself, and continue onboarding once it is in range. Tell the user one line ("The coach needs a newer version of a program it runs on; I'm installing it now."); the version and the tool are your choice, never a question. Each shell command starts fresh, so load the manager in the same command as the step that needs it. Use the first manager the check found:
  - nvm: `. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm install && nvm alias default "$(cat .nvmrc)"` (it reads `.nvmrc`).
  - fnm: `eval "$(fnm env)" && fnm install && fnm default "$(cat .nvmrc)"`.
  - volta: `volta install node@"$(cat .nvmrc)"`.
  - Homebrew: `brew upgrade node`, or `brew install node` when Homebrew has none.
  - None, on macOS: download `https://nodejs.org/dist/v<version>/node-v<version>.pkg` (version from `.nvmrc`) into a scratch folder outside this one. The installer needs the user's computer password, so hand over exactly one line with its reason: "This step asks for your computer password, so it has to be typed by you: `! sudo installer -pkg <path> -target /`".
  - None, on Linux or WSL: download `node-v<version>-linux-x64.tar.xz` (`linux-arm64` when `uname -m` says `aarch64`) from the same place, unpack it into `$HOME/.local/node`, and add `export PATH="$HOME/.local/node/bin:$PATH"` to the shell's startup file (`~/.bashrc` or `~/.zshrc`). No password is needed.

  Then check in a fresh command: `node --version` must be in range. If an old version still shows, `which -a node` lists every copy; the first one is hiding the new one. Fix the order yourself (the manager's default, or the new folder first on the path in the startup file) and check again. Finally run `npm ci` to install the coach's own tools; it takes a minute or two, so say so first.
- No git (the check printed `no git`), or `git rev-parse --show-toplevel` names a folder other than this one: this folder keeps no history, and the coach saves nothing beyond the files themselves. Say nothing about it, never suggest installing anything for it, and skip the bullets about the online copy.
- No `origin`: the data stays on this computer. Tell the user that in one line; nothing to ask.
- `origin` is `leonardoazeredo/job-coach` (copied straight from the public project): nobody else's data can reach it, but unlink it so nothing ever can. Say: "This folder was copied from the public project online. I'll unlink it so what you add here stays on this computer; updates to the coach still work." On a yes, run `git remote rename origin upstream`; the update-coach skill finds the engine under that name.
- Any other `origin` that answers 200 (public): stop and say plainly that this folder is linked to a public page online, where anything saved could be seen by anyone, and that nothing personal goes in until that is fixed. If the user made it with **Use this template**, `gh repo edit --visibility private --accept-visibility-change-consequences` (or the repository's Settings page) makes it private; a fork cannot be made private, so the user starts again from the template, or unlinks with `git remote rename origin public-copy` and keeps the data local.
- `origin` answers 404, or is not on GitHub: say the online copy is private or cannot be checked, and ask one plain question: "Is the online copy of this folder set to private, or would you rather keep everything on this computer?" Keeping it local means `git remote rename origin unused-online-copy` after a yes.
- No Chrome or no poppler is a warning, not a stop: only PDF export needs them, and it is optional and can be set up later. A PDF CV can still be imported in step 2 without poppler. Offer to install them, and on a yes run the install yourself: `brew install --cask google-chrome` and `brew install poppler` on macOS. On Debian or Ubuntu, `sudo apt install chromium poppler-utils` needs the computer password, so it goes to the user as one `! ` line with that reason. Elsewhere, set `CHROME_PATH` to a Chrome program the user already has.

Done when Node is in range and `npm ci` has run, the data either stays on this computer or goes only to an online copy that is private, and each warning has been shown.

### 2. CV import

Ask: "Paste your CV or LinkedIn text, or give me a PDF path." For a PDF, read it with the Read tool, or with `pdftotext -layout <path> -` when poppler is present.

Draft, from that source only, one file at a time:

1. `profile/history.yaml`: one entry per role, newest first, with `id`, `company` and the `public` block. Titles, dates and employment type are the public labels. Ask about one unclear date or title per reply.
2. `profile/stack.yaml`: core, secondary, past and tools, sorted by depth. Technologies the CV shows only briefly go to `secondary` or `past` with `roles` and `claim_as` limits. Ask one thing for `do_not_claim`: "What work would a recruiter for your kind of role assume you have done, that you have not?" Where the source names a tool only generically ("the route-planning package"), ask its name, one tool per reply; a name the user cannot give stays generic in the file, and you say so.
3. `cv/master.json`: bullets reworded only from what the source says, metrics exactly as in the source.
4. `profile/wins.yaml`: candidate wins from the bullets, each `status: proposed`, `metric: "Not specified"` unless the source states one. `check.ts` needs this file to exist, and the board lists step 4 while any win is `proposed`. Never mention that listing, or a reminder it stands for, to the user.

Done when the four files exist and each person-fact in them traces to the pasted source or an answer.

### 3. Identity and targets

Ask these in this order, skipping what the source already gives. Each item is one question and one reply; never put two items in one question.

1. Name.
2. Pronouns.
3. Spelling (`en-GB`, `en-US`).
4. Language to be coached in.
5. City.
6. Timezone.
7. Since when they have lived there.
8. Right to work, one country per reply.
9. Years of professional experience.
10. Roles they want.
11. Seniority.
12. Discipline.
13. Salary floor.
14. Currency.
15. Levels.
16. Remote or hybrid.
17. Office days, if hybrid.
18. What a good role has.
19. What would rule a role out, with examples from any field such as hours, travel or employers to avoid.
20. Regions to look in.
21. Job titles to look for.

Draft, one file at a time:

1. `profile/identity.yaml`. Leave `competency_pack` unset; step 6 sets it.
2. `profile/search.yaml`: three tiers worded with the user's own criteria and currency, a `min_stack_overlap_pct`, a location rule in prose, `fit.hard_limits` (one plain sentence per limit the user named; an empty list if they named none, and say that plainly), and the discovery titles and search. The salary floor lives in `identity.yaml` only.
3. `profile/coach.md`: the four bullets, in the user's language and tone. This file is the gate CLAUDE.md checks, so write it last.

Seniority is the level the user named, written in the board's own word (`docs/boards/rocketship.md`) and shown in plain words in the summary. The draft refuses while no level is given: when the user has named none, ask for it.

Done when the three files exist, `timezone` is an IANA name and `locale` a language tag (the scripts reject others).

### 4. Wins

Take the wins in `profile/wins.yaml` one by one. For each: show the action and the metric, then ask only "Is this exactly how you would say it?" and wait. The reply is the whole ask: request no further figure or detail in it. The metric is written word for word as the user says it, qualifiers included ("contributed to", "up to"); a correction replaces the wording, and a win left at `Not specified` gets its own ask for a number in the next reply. Ask for `never_say` inflations: the stronger version of the claim that a draft might drift into. A win the user cannot put a metric on keeps `Not specified`. Set `status: approved` only on the user's yes to that win. Add wins the user raises, with `role` matching a `history.yaml` id. Each approval or correction is a draft of `profile/wins.yaml` naming the win by `slug` with only the changed values.

Done when no win is `proposed` without the user's say-so.

### 5. Voice

Ask for two or three samples of the user's own writing (an email, a post, a cover note) Once those are in, ask in a reply of its own for a spoken answer typed out, which the user may skip. Draft `profile/voice.md`: traits seen in the samples, written and spoken registers, words and habits to avoid. Quote a phrase from a sample for each trait so the user can check it.

Done when every trait in the file traces to a sample.

### 6. Competency pack

The pack is the list of competencies an ad can ask for and the evidence a bullet must show. List `config/competencies/`. The user chooses; do not pick one from their field. If one fits the user's discipline, draft `profile/identity.yaml` with `competency_pack` set to that pack. If none fits, write `config/competencies/<name>.yaml` (a pack is not a profile file, so the Draft command does not take it) in the shape of `config/competencies/frontend.yaml`: 8 to 12 competencies, each with `id`, `label`, `ad_words`, `win_themes`, `slots` and one `questions` entry per slot, plus the top-level `themes` list. Use the user's discipline for `ad_words` and the questions; keep the ids that skills refer to (`stakeholder-management`, `technical-leadership`, `system-design`, `mentoring`, `ownership-delivery`, `influence-push-back`, `cross-functional-collaboration`) when they fit. Then draft `profile/identity.yaml` with `competency_pack` set to the new name, and `profile/wins.yaml` with the `competencies` and `themes` each win should use.

Ask the yes for a new pack over a summary of the competency names, saying that its ad words, evidence slots and questions come with it; show them in full only when the user asks.

This step is required: do not finish onboarding until `competency_pack` is set. Done when `competency_pack` names a file that exists and every win's `competencies` and `themes` appear in it.

### 7. Optional sensitive sections

Offer each in one sentence on why it exists, and draft it only if the user opts in:

- `profile/history-private.yaml`: facts about past roles that must never reach outward material, such as a payroll title that differs from the public one or a background-check risk. Only interview-prep and offer-review read it. After the opt-in, ask for each role in `history.yaml`, one per reply, whether the contract title differs from the public one. A title that differs goes in that role's `payroll_title`; otherwise leave the key out.
- `profile/standard-answers.yaml`: answers to the questions every application form asks, so application-writer reuses the user's wording. Ask the earliest start date as its own question for `earliest_start`. Salary answers come from `identity.yaml` levels.
- Salary history: kept in `history-private.yaml` per role under `salary_history`, only on request.

Done when each of the three is written or declined.

### 8. Check and next step

1. If `profile/lessons.md` is missing, say that you will start an empty list for lessons from interviews, which interview-debrief adds to, and draft it as text in the shape of `templates/profile/lessons.example.md` on a yes. If `profile/glossary.md` is missing, offer it in one line (the terms only the user uses, such as named companies or the searches they keep for one tier) and draft it in the shape of `templates/profile/glossary.example.md` on a yes; the board never lists it.
2. Run `node scripts/check.ts`. Errors name the file; fix that file with the user through a draft of the changed values, and rerun until it exits 0. Warnings are read out and explained.
3. Run `node scripts/board.ts` and show the "Onboarding unfinished" list, if any, as what remains.
4. End with one suggested next step: "Paste a job ad or a link and I'll check how well it fits what you're after."

Done when `check.ts` exits 0 and the unfinished list holds only sections the user deferred, never step 6.
