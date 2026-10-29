---
name: cv-for-role
description: Build a tailored CV for one role in the pipeline. Breaks the job ad into requirements, finds evidence in wins and the experience bank, interviews the user only about what is missing, writes sourced bullets and exports a verified PDF. Use when the user asks for a CV for a specific job.
---

# CV for a role

Tailor the CV to one ad without saying anything the files cannot back. Every line on the CV cites its source; a script refuses to build the CV otherwise. Background and research: `docs/cv-for-role.md`.

## Read first
- `pipeline/<slug>/jd.md` and `record.yaml` (run job-intake first if the role has no folder)
- `config/competencies/<pack>.yaml` (the pack is `competency_pack` in `profile/identity.yaml`), `config/cv.yaml`
- `profile/wins.yaml` (approved only), `profile/history.yaml` (public fields), `profile/stack.yaml`
- `cv/master.json`
- `pipeline/<slug>/requirements.yaml` and `cv/bullets.yaml` if they exist (resume, do not restart)

## Phase 1: break the ad down

Write `pipeline/<slug>/requirements.yaml`:

```yaml
role: <slug>
jd: jd.md
requirements:
  - id: r1
    quote: "You enjoy working in a large front-end codebase with many stakeholders."   # verbatim
    kind: competency            # technology | competency | domain | scope | logistics
    competency: stakeholder-management   # an id from the competency pack
    weight: strong              # must | strong | nice
    keywords: [stakeholders]    # the ad's own words
    status: gap                 # covered | partial | gap | not-claimable | dropped
    evidence: []                # filled in phase 2
    missing_slots: []
```

1. Quote the ad; never paraphrase a requirement. Keywords keep the ad's spelling.
2. Weight from the ad's words: "required", "you have" and the opening bullets are `must`; "you should apply if" items are `strong`; "nice to have", "bonus" and "e.g." lists are `nice`.
3. Split a compound bullet only when its parts need different evidence.
4. Technologies are graded against `stack.yaml` with no interview. A `do_not_claim` hit is `not-claimable` and is never asked about.
5. Logistics (location, right to work, salary) are `logistics`; they never reach the CV.
6. About 12 items at most; merge or drop `nice` items past that and say which.

## Phase 2: find evidence

1. Run `node scripts/cv-evidence.ts <slug>`. It lists, per requirement, approved wins and answered experience-bank questions that may hold evidence, and which technologies the stack covers.
2. Read the candidates and decide which slots of the competency each one fills (`slots` in the competency pack). Record them in `evidence` as `{ref, slots}`; put the rest in `missing_slots`.
3. Status: `covered` when every slot is filled (evidence listed, `missing_slots` empty), `partial` when there is some evidence but it falls short, `gap` when nothing fits. `node scripts/cv-lint.ts <slug>` fails a covered requirement with missing slots and a covered or partial one with no evidence; it warns about a gap or not-claimable one that still lists evidence.
4. Show the user one coverage table: requirement, status, best evidence, missing slots. The user may drop requirements (`dropped`) or say "that never happened" before any question.

## Phase 3: interview for the gaps

Ask only for missing slots, `must` first, then `strong`; about 8 questions per role at most.

- Start from the competency's question templates. Open with "if", never assume the event happened ("Did you ever push back on a CEO decision? If so...").
- Name what is already on file so the user can correct it, with its ref ("At Brightwell you partitioned the tracking-events table (bank:brightwell#4)").
- Ask for countable facts (how many people, how often, how long) and accept "not sure".
- Ask about the user's own part apart from the team's.
- Cards are fine for speed; card wording is the coach's, so quotes come from the user's typed or recorded words.
- "I don't remember" and "that never happened" are answers. Save them; the requirement stays a gap.

Save every answer in the same turn, using experience-mining's targeted follow-up mode (it appends to `experience-bank/<role-id>.md`, tags the question, and proposes wins for the user's yes). Then re-run `cv-evidence` and update `requirements.yaml`.

## Phase 4: write the bullets

Write `pipeline/<slug>/cv/bullets.yaml`:

```yaml
role: <slug>
headline: optional, defaults to master
summary: {text: "...", sources: [stack, history:brightwell]}   # optional, defaults to master
skills: [optional reordered list, each in stack.yaml; a limited item written as its claim_as]
jobs:                         # history.yaml ids; jobs left out are omitted from the CV
  - id: cedarline-payments
    tech: [optional override of master's list]
    bullets:
      - text: "Led the move from ..."
        sources: [win:cl-pager-load, bank:cedarline-payments#2]
        answers: [r1]
```

Source refs: `win:<slug>` (approved only), `bank:<role-id>#<n>` (answered only), `history:<role-id>`, `stack`.

Allowed:
- Choosing and ordering bullets so the ad's top requirements lead in each recent role.
- New verbs and sentence shape, within the strength rule below.
- The ad's word for the same thing ("stakeholders" for the product and sales leads the user worked with).
- Combining facts from the same role and sources; shortening without cutting a qualifier.

Not allowed:
- Changing a metric. A metric clause (split on ";") is quoted whole from `wins.yaml`, qualifiers included.
- Any number not in a cited source; any fact cited from another job.
- A title, date, company or employment type other than `history.yaml` public fields (the build takes these from history anyway).
- Absorbing others' work. "Contributed to" stays.
- `never_say` phrases, `do_not_claim` items, proposed wins.
- A keyword with no evidence, or only in the skills list.

Strength: "led", "owned", "managed", "mentored", "drove", "architected" and similar need a source that uses the same verb. Otherwise use the source's verb, or ask the user and add `strength_ok_by: user` once the user confirms.

No number: keep the action and a qualitative result in the user's words. "Not specified" never appears on the CV.

Shape: 2 to 5 bullets for each recent job (the newest `recent_jobs` in `config/cv.yaml`, three by default), 0 to 2 for older ones. The first bullet of each recent job answers the ad's top requirement.

## Phase 5: check and export

1. `node scripts/cv-lint.ts <slug> --warnings`. Fix every error; read every warning (omitted jobs, tech outside the stack, bullet counts) and decide.
2. `node scripts/cv-export.ts <slug>`. It lints again, writes `cv/cv.json` and `cv/keywords.txt`, and prints the PDF with the in-repo exporter, whose verifier also checks that the ad's keywords survive extraction. It needs Chrome (set `CHROME_PATH` if it is not in a standard place or on Windows) and poppler. If either is missing here, run `node scripts/cv-build.ts <slug>` and give the user the export command to run on a machine that has them.
3. Reply with: the PDF path, which requirements the CV covers and with which win or answer, the gaps left out, and any warning the user should decide on.
4. When the user says the CV was sent, hand over to pipeline-update.

## Rules
- Never edit `cv/master.json` or `profile/` without showing the change and getting the user's yes.
- `cv/cv.json` is built output; change `bullets.yaml` and rebuild instead of editing it. Wording changed in the PDF by hand goes back into `bullets.yaml` and is linted again.
