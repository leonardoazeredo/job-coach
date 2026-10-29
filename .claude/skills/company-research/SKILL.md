---
name: company-research
description: Research a company for an application or interview, covering funding, product, engineering team and blog, leadership, recent news and likely pain points, with every fact sourced. Use when the user asks to research a company, before interview-prep if no recent research exists, and for tier 0 or 1 roles after job-intake.
---

# Company research

Sourced facts only. Everything lands in `pipeline/<slug>/research.md`, which other skills treat as the only allowed source of company facts besides the job ad.

## Read first
- `pipeline/<slug>/record.yaml` and `jd.md`
- Existing `research.md` (update it, do not start over)

## Steps

1. **Search and open sources.** Prefer, in order: the company's own site, careers page and engineering blog; funding announcements and reputable press; interviews or talks by its CTO or engineering leaders; Glassdoor or similar for interview process only. Open each page you take a fact from; a search snippet is not a source.
2. **Collect facts** under these headings, each fact with its source link and the date it was published or checked:
   - Company: what it sells, to whom, size, stage, funding (round, amount, date, lead).
   - Product and roadmap: recent launches, stated plans.
   - Engineering: stack, team size, structure, blog themes, open-source work.
   - People: leaders and the interviewers the user names, with public role info only.
   - Interview process: reported stages and question types (label as "reported by candidates").
3. **Infer pain points.** Separate section titled "Inferences". Each inference names the facts it rests on and maps to win themes (performance, modernisation, leadership, process, product impact, AI, design systems). Suggest 1 to 2 win slugs per pain point.
4. **Write** `research.md` with a "Checked on <date>" line at the top, and a short "Unknown" list for things the user may want to ask in an interview.
5. **Reply** with 5 to 8 bullet highlights and the file link.

## Rules
- No unsourced numbers. If a figure (funding, revenue, salary band) cannot be found, write "Not found" rather than estimate.
- Salary benchmarks from third-party sites are allowed only with their source and range, labelled as benchmarks, and never copied into `record.yaml`.
- Facts older than 18 months are marked as possibly stale.
