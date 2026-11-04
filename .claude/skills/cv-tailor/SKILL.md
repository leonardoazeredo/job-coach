---
name: cv-tailor
description: Improve the user's master CV (cv/master.json), its ATS keyword coverage or its bullet points. Use when the user shares their CV or a list of missing ATS keywords. For a CV tailored to one job, use cv-for-role instead.
---

# CV tailor

Edit the CV JSON so every line is true, specific and traceable.

## Read first
- `cv/master.json`
- `profile/history.yaml` (public fields), `profile/wins.yaml` (approved wins only), `profile/stack.yaml`
- `experience-bank/` files for the roles being edited

When a `cv-*` script refuses because no competency pack is chosen, stop there. Tell the user in one plain sentence that the coach needs to know their field before it can check a CV, and hand over to onboarding's competency pack step. The user chooses the pack; never set `competency_pack` or pick one from their field yourself.

## Steps

1. **Decide the target.** This skill edits the master CV. A CV for one role is built by cv-for-role (sourced bullets in `pipeline/<slug>/cv/`); hand over to it. Changes to `master.json` go through `node scripts/profile.ts` (step 5).
2. **Check identity fields.** Company, title, employment type and dates for every job must match `history.yaml` public fields exactly (for example "Senior Backend Engineer", permanent, 2022-03 to 2024-06).
3. **Keywords.** For each keyword requested (from an ATS report or the job ad):
   - Find evidence: `stack.yaml`, a win, or an experience-bank answer. Record where.
   - With evidence: place it where it was actually used (in that job's bullet or tech list), not only in the skills list.
   - Without evidence: leave it out and list it as a gap in the reply.
4. **Bullets.** Each bullet is action plus result, starts with a strong verb, and draws on one approved win or an experience-bank fact. Quote metrics exactly. 2 to 4 bullets for recent roles, 1 for early roles.
5. **Draft and write.** Run `node scripts/profile.ts draft cv/master.json` with JSON on stdin holding only the values that change: a job by its `id` with its new `bullets` or `tech` (a list replaces the old one whole, so give it complete), and `skills` when it changes. Relay the printed summary as it is, with at most one framing sentence, and wait for the yes. On the yes, run `node scripts/profile.ts write cv/master.json`, then `node scripts/save.ts`. A no or a correction goes back to the draft.
6. **Reply** with why each change was made (the summary has what changed), the evidence for each added keyword, and the list of keywords left out.

## Rules
- Proposed (unapproved) wins are not used until the user approves them.
- No ranges inflated, no "Staff" title that the user did not hold.
