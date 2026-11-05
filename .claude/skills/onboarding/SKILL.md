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

- Every write to `profile/*` or `cv/master.json` follows Showing a change in CLAUDE.md, run from the folder's root: `node scripts/profile.ts draft <file>` takes the values as JSON on stdin (keys as in the file's template; a markdown file takes its whole text, under the headings its template shows). Relay each summary with at most one framing sentence of your own. The step is done when the file is written or the user defers it. After the section's writes, one `node scripts/save.ts`.
- A draft that is refused names each value it still lacks. Ask about them in turn, one per reply. `null` is the user's answer ("there is none"), never yours; the refusal's "or null" is for that case only. This holds for `career_gaps`: ask whether there is a gap to explain, or leave the entry out and say only that it was left out. "There are no gaps" is never yours to state. Give the draft only values the user or the source supplied; a key you leave out keeps the template's default.
- A yes on a summary is the only thing asked in its reply. An offer (a change to the CV, saving, more phrases, the glossary) never shares a reply with a question or a summary: it waits for a reply of its own, or for the end of setup.
- Never state a reason on the user's behalf that they did not give ("as you have no LinkedIn", "because you didn't need one"), in a summary's framing sentence or anywhere else. Say what is true of the file, or ask.
- The user's pasted CV, LinkedIn text or PDF is the source for this session. A value the source does not hold is asked, never inferred: one specific question at a time. Each reply asks one thing and waits (the wording-and-overclaim question in step 4 counts as one thing, as that step defines it); asking for a yes on a summary counts as that one thing, so a further question waits for the next reply. CLAUDE.md's rule for a value given only in part covers the location of a job or course too: "Bradford" stays "Bradford", and a college's name does not give its location. If the source gives none, ask once whether there is one; a CV reads fine without it, and the user's "none" is `null`. The same goes for a course's start date: `null` for `start` on the user's "none", never an empty string.
- Required steps are 1, 2, 3, 6 and 8. Offer to defer each of 4, 5 and 7: a deferral is one line to the user ("It stays on your list for later") and changes no file.
- A file that already exists is updated, never replaced: the input names only the values that change (Re-runs).

## Re-runs

At the start, run `node scripts/board.ts` and list each section as done, unfinished or never started, then ask which to work on. Draft an existing file with only the values the user asked to change: the summary then lists just those, and anything not named stays as it is. Removing a job, win or tool needs an explicit remove entry in the input (`{"remove": "<id>"}` in the list).

## Steps

### 1. Prerequisites and keeping the data private

Read `.claude/skills/onboarding/prerequisites.md` and carry it out, before any other step on a first run. A re-run needs it only when the user picks this step.

Done when Node is in range and `npm ci` has run, the data either stays on this computer or goes only to an online copy that is private, and each warning has been shown.

### 2. CV import

Ask: "Paste your CV or LinkedIn text, or give me a PDF path." For a PDF, read it with the Read tool, or with `pdftotext -layout <path> -` when poppler is present.

Draft, from that source only, one file at a time:

1. `profile/history.yaml`: one entry per role, newest first, with `id`, `company` and the `public` block. Titles, dates and employment type are the public labels. Ask about one unclear date or title per reply.
2. `profile/stack.yaml`: core, secondary, past and tools, sorted by depth. Technologies the CV shows only briefly go to `secondary` or `past` with `roles` and `claim_as` limits. Ask one thing for `do_not_claim`: "What work would a recruiter for your kind of role assume you have done, that you have not?" Write each pattern to catch the claim itself; a refusal that names a line of the CV means the pattern also catches something true, so narrow it and draft again. Where the source names a tool only generically ("the route-planning package"), ask its name, one tool per reply; a name the user cannot give stays generic in the file, and you say so.
3. `cv/master.json`: the headline as the source writes it (asked for when the source has none), bullets reworded only from what the source says, metrics exactly as in the source.
4. `profile/wins.yaml`: candidate wins from the bullets, each `status: proposed`, `metric: "Not specified"` unless the source states one. `check.ts` needs this file to exist, and the board lists step 4 while any win is `proposed`. Never mention that listing, or a reminder it stands for, to the user.

Done when the four files exist and each person-fact in them traces to the pasted source or an answer.

### 3. Identity and targets

Ask these in this order, skipping what the source or an earlier answer already settles. A skipped value still appears in the summary for the user's yes, so nothing goes unseen. A value is settled only when it is stated: one you inferred stays a question, with the exceptions named here and below: the timezone follows from a city the user gave, so item 10 is not asked and the timezone is shown in the summary for a yes. A level the user already answered (item 17, or the same word given while answering another item) is not asked again, and the discipline (item 18) is not asked when the CV or an earlier answer states it. Each item is one question and one reply; never put two items in one question.

| # | Ask | Goes in |
| --- | --- | --- |
| 1 | Name | `name` |
| 2 | Pronouns | `coach.md` only |
| 3 | Email | `email` |
| 4 | Phone | `phone` |
| 5 | Links: LinkedIn, then GitHub, one per reply | `linkedin`, `github` |
| 6 | Spelling (`en-GB`, `en-US`) | `locale` |
| 7 | Language to be coached in | `coach.md` only |
| 8 | Languages they speak, with their level in each | `languages` |
| 9 | City | `location` |
| 10 | Timezone | `location` |
| 11 | Since when they have lived there | `location` |
| 12 | Right to work, one country per reply | `right_to_work` |
| 13 | Notice period | `availability` |
| 14 | Earliest start date | `availability` |
| 15 | Years of professional experience | `experience_years` |
| 16 | Roles they want | target line of `coach.md`, discovery titles of `search.yaml` |
| 17 | Seniority | `seniority_targets` |
| 18 | Discipline | target line of `coach.md` |
| 19 | Salary floor | `compensation` |
| 20 | Currency | `compensation` |
| 21 | Levels: the pay range for each level they named in item 17, under those same words | `compensation` |
| 22 | Remote or hybrid | `work_setup.remote` |
| 23 | Office days, if hybrid | `work_setup.office_days_ok` |
| 24 | What a good role has | `ideal_role_criteria` |
| 25 | What would rule a role out, with examples from any field such as hours, travel or employers to avoid | `fit.hard_limits` in `search.yaml` (Hard limits below) |
| 26 | Regions to look in | `location_rule` in `search.yaml` |
| 27 | Job titles to look for | discovery titles of `search.yaml` |
| 28 | Which words in a job title show it is their kind of work, such as a language, a tool or a speciality | `discovery.field_terms` in `search.yaml` |

Two more items are settled without a question unless the user's words leave them open. Item 7: the language the user writes to you in counts as stated, so coach in it. Item 12: the countries the user named are the whole list, so do not ask for others, and the list is shown in the summary for the user's yes; "for now" or "and maybe elsewhere" leaves it open, and then ask once.

Each answer has one place, in the table; a key with no file named is in `identity.yaml`, and the two `coach.md` only items stay out of that file's input. The user's "none" for 28 is `[]`, not `null`, because a list left out reads as a question never asked. `discovery.excluded_words` starts empty and is not asked about. A question with no row is not asked.

A refused draft is put to the user as what you need from them, in their words ("I still need your notice period"), never naming a file or a key.

Draft, one file at a time:

1. `profile/identity.yaml`. Leave `competency_pack` unset; step 6 sets it.
2. `profile/search.yaml`: three tiers worded with the user's own criteria and currency, a `min_stack_overlap_pct`, a location rule in prose, `fit.hard_limits` (see below), and the discovery titles and search. The salary floor lives in `identity.yaml` only.
3. `profile/coach.md`: the four bullets, in the user's language and tone. This file is the gate CLAUDE.md checks, so write it last.

Hard limits hold only what the user says rules a role out, one plain sentence each, in their words. "I'd rather avoid", "prefer not" and "would like to avoid" state a preference, not a limit. When the words leave it open, ask once: "Would that rule a role out, or is it something you would rather avoid?". A preference goes into `ideal_role_criteria` in the user's words when it describes what they want, or is left out, and you say which. With no limit named, the list is empty and you say so plainly.

A condition the user attaches to a title ("Transport Manager only at a small firm") is never dropped silently: the title stays out of the discovery titles, which have no place for a condition, and the condition goes into `ideal_role_criteria` in the user's words. Tell the user in one sentence where it went, or that it was left out.

Seniority is the level the user named, written in the board's own word (`docs/boards/rocketship.md`) and shown in plain words in the summary. The draft refuses while no level is given: when the user has named none, ask for it.

Done when the three files exist, `timezone` is an IANA name and `locale` a language tag (the scripts reject others).

### 4. Wins

Take the wins in `profile/wins.yaml` one by one, two turns each. In the first, show the action and the metric and ask one question that covers both the wording and the overclaim: "Is this exactly how you would say it, and what is the stronger version someone might put down that you would not claim?" One reply answers it. When the reply answers only part, take what it gave and ask for the other part in the next reply, as that one question alone. The metric is written word for word as the user says it, qualifiers included ("contributed to", "up to"); a correction replaces the wording, and a win left at `Not specified` gets its own ask for a number in the next reply. The stronger version goes into `never_say`; say it to the user in those words. A win the user cannot put a metric on keeps `Not specified`.

In the second turn, draft `profile/wins.yaml` naming the win by `slug` with only the changed values, and relay the summary for a yes. A win with nothing to change (right wording, nothing for `never_say`) spends no further turn: its summary, showing only `status: approved`, is the second turn. `status: approved` is set only on the user's yes to that summary. Add wins the user raises, with `role` matching a `history.yaml` id.

Done when no win is `proposed` without the user's say-so.

### 5. Voice

Ask for two or three samples of the user's own writing (an email, a post, a cover note) Once those are in, ask in a reply of its own for a spoken answer typed out, which the user may skip. Draft `profile/voice.md`: traits seen in the samples, written and spoken registers, words and habits to avoid. Quote a phrase from a sample for each trait so the user can check it.

Done when every trait in the file traces to a sample.

### 6. Competency pack

The pack is the list of competencies an ad can ask for and the evidence a bullet must show. List `config/competencies/`. The user chooses; do not pick one from their field. If one fits the user's discipline, draft `profile/identity.yaml` with `competency_pack` set to that pack. If none fits, write `config/competencies/<name>.yaml` (a pack is not a profile file, so the Draft command does not take it) in the shape of `config/competencies/frontend.yaml`: 8 to 12 competencies, each with `id`, `label`, `ad_words`, `win_themes`, `slots` and one `questions` entry per slot, plus the top-level `themes` list. Use the user's discipline for `ad_words` and the questions; keep the ids that skills refer to (`stakeholder-management`, `technical-leadership`, `system-design`, `mentoring`, `ownership-delivery`, `influence-push-back`, `cross-functional-collaboration`) when they fit. Then draft `profile/identity.yaml` with `competency_pack` set to the new name, and `profile/wins.yaml` with the `competencies` and `themes` each win should use.

Ask the yes for a new pack over a summary of the competency names, saying that its ad words, evidence slots and questions come with it; show them in full only when the user asks. The names in that summary are the `label` values exactly as they will be written. When the user rewords the list, write the file with their words in `label` and keep each `id`; the file is written only after the yes on the list the user last saw.

This step is required: do not finish onboarding until `competency_pack` is set. Done when `competency_pack` names a file that exists and every win's `competencies` and `themes` appear in it.

### 7. Optional sensitive sections

Offer each in one sentence on why it exists, and draft it only if the user opts in:

- `profile/history-private.yaml`: facts about past roles that must never reach outward material, such as a payroll title that differs from the public one or a background-check risk. Only interview-prep and offer-review read it. After the opt-in, go through each role in `history.yaml`, one question per reply: whether the contract title differs from the public one, why the role ended, and each other value the refusal names. A title that differs goes in that role's `payroll_title`; the user's "none" for any of them is `null`.
- `profile/standard-answers.yaml`: answers to the questions every application form asks, so application-writer reuses the user's wording. `earliest_start` is the answer to step 3 item 14; ask it again only if that step was skipped. Salary answers come from `identity.yaml` levels.
- Salary history: kept in `history-private.yaml` per role under `salary_history`, only on request.

Done when each of the three is written or declined.

### 8. Check and next step

1. If `profile/lessons.md` is missing, draft it as text in the shape of `templates/profile/lessons.example.md`, an empty list for lessons from interviews, which interview-debrief adds to. Never draft it before step 7 begins. Draft it in the same turn as the last summary of step 7 (the last section the user opted into), never in the turn after it; relay both summaries, and let that one yes cover both. When step 7 shows no summary, draft it alone here. When the reply is a yes to only one, or ignores the list, write what was agreed and ask about the list once more on its own. If `profile/glossary.md` is missing, offer it in one line, in a reply of its own after the lessons list is settled (the terms only the user uses, such as named companies or the searches they keep for one tier) and draft it in the shape of `templates/profile/glossary.example.md` on a yes; the board never lists it.
2. Run `node scripts/check.ts`. Errors name the file; fix that file with the user through a draft of the changed values, and rerun until it exits 0. Warnings are read out and explained.
3. Run `node scripts/board.ts` and show the "Onboarding unfinished" list, if any, as what remains.
4. Say that nothing is left only when no draft or offer is waiting, the lessons list and the glossary offer included, and never in the reply that makes an offer. End with one suggested next step: "Paste a job ad or a link and I'll check how well it fits what you're after."

Done when `check.ts` exits 0 and the unfinished list holds only sections the user deferred, never step 6.
