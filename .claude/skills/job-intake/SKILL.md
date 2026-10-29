---
name: job-intake
description: Extract and vet one job ad the user pastes or links. Use when the user shares a single job description, a job URL, or says "now this one" / "intake this role". Writes a pipeline record and gives a fit verdict, tier and hook. For a list of several roles, use role-triage instead.
---

# Job intake

Turn one job ad into a pipeline record, decide fit and tier, and propose a hook. One role per run.

## Read first
- `profile/stack.yaml` (matching and do_not_claim)
- `profile/identity.yaml` (location, right to work, compensation, ideal_role_criteria)
- `profile/wins.yaml` (hook)
- `config/rules.yaml` (fit, tiers, discovery)
- `pipeline/` folder names, to catch duplicates

## Steps

1. **Duplicate check.** Build the slug (`<company>-<role-short>`). If a folder for the same company and a similar title exists, show it and ask whether this is the same role before writing anything.
2. **Save the ad.** Write the pasted text verbatim to `pipeline/<slug>/jd.md`, with the URL and today's date at the top. If the user only gave a link, fetch it; if fetching fails, ask the user to paste the text.
3. **Extract.** Fill `record.yaml` from `pipeline/_templates/record.yaml`.
   - Copy lists (responsibilities, required tech) verbatim from the ad.
   - Anything not in the ad is "Not specified". Do not fill salary, funding or benefits from memory.
   - Separate required from nice-to-have technologies.
4. **Match.** For each required technology, look it up in `stack.yaml`:
   - in `core` → core_stack_matches; in `secondary` → secondary_stack_matches; in `past` or `tools` → other_relevant_experience; otherwise → tech_stack_gaps.
   - A limited entry (`{name, roles, claim_as}`) matches by its `name`, in its section like any other entry.
   - Any `do_not_claim` hit goes in gaps with a note.
   - Only technologies count (`rules.yaml` fit.overlap_rule). Items such as "CMS", "component libraries", "agile" or "performance metrics" are left out of the count; put them in `other_relevant_experience` with a note if a win covers them.
   - stack_overlap_pct = (core + secondary matches) / counted required technologies, rounded.
5. **Fit verdict.** Apply the fit rules (`config/rules.yaml` and `profile/search.yaml`) in this order: hard gap, location, salary floor (tested against the top of a published range). The first failing rule gives "Not a fit" and the reason. Otherwise the overlap decides: at or above `min_stack_overlap_pct` is "Strong fit", below it is "Potential fit" with every gap named. `ideal_role_criteria` shape the one-line reason and `values_match` / `values_miss`; they never give "Not a fit" on their own. Check titles against `discovery.title_expansion` before dismissing a title that does not name the user's field.
6. **Tier.** Only for verdicts outside `rules.yaml` `fit.untiered` (those take `tier: null`), using `rules.yaml` tiers. A salary threshold is met when the top of the published range reaches it.
7. **Hook.** Pick 1 to 2 win slugs whose themes match the ad's likely pain point. Label the pain point as an inference. Write a one-sentence pitch quoting the win's metric exactly.
8. **Write** `record.yaml` with status `Identified`, `dates.identified` = today, and create `events.md` from the template with an "Identified" line. Run `node scripts/check.ts` and fix any error before replying.
9. **Reply** with the short summary below. Do not print the full record unless the user asks; it is in the file.

## Reply format

```
**<Company>, <Job title>**: <Strong fit | Potential fit | Not a fit> · Tier <n>
<one-line reason>

- Location / setup: ...
- Salary: <as written, or Not specified>
- Stack: <n>% of required. Gaps: <list or none>
- Hook: <win slug>: "<one-sentence pitch>"

Saved to pipeline/<slug>/. <One suggested next step, e.g. "Want answers for their form?">
```

## Rules
- Never claim a match that is not literally in `stack.yaml`. "Redux" in the ad matches only if Redux is listed.
- Never quote a win metric differently from `wins.yaml`.
- A rejection or skip decision always carries a reason in `status_reason`.
- Salary above the floor but with a top end below the range for the role's level (`identity.compensation.by_level`) stays a fit; add "(below target range)" after the salary line in the reply.
- If the user says they have already applied, hand the event to pipeline-update after writing the record.
