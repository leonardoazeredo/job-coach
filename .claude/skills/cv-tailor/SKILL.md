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

## Steps

1. **Decide the target.** This skill edits the master CV. A CV for one role is built by cv-for-role (sourced bullets in `pipeline/<slug>/cv/`); hand over to it. Never overwrite `master.json` without the user's yes.
2. **Check identity fields.** Company, title, employment type and dates for every job must match `history.yaml` public fields exactly (for example "Senior Backend Engineer", permanent, 2022-03 to 2024-06).
3. **Keywords.** For each keyword requested (from an ATS report or the job ad):
   - Find evidence: `stack.yaml`, a win, or an experience-bank answer. Record where.
   - With evidence: place it where it was actually used (in that job's bullet or tech list), not only in the skills list.
   - Without evidence: leave it out and list it as a gap in the reply.
4. **Bullets.** Each bullet is action plus result, starts with a strong verb, and draws on one approved win or an experience-bank fact. Quote metrics exactly. 2 to 4 bullets for recent roles, 1 for early roles.
5. **Reply** with a short diff (what changed and why), the evidence for each added keyword, and the list of keywords left out.

## Rules
- Proposed (unapproved) wins are not used until the user approves them.
- No ranges inflated, no "Staff" title that the user did not hold.
- Keep the JSON valid; check it parses before saving.
