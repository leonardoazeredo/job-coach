# Per-role CV generation

How `cv-for-role` tailors a CV to one job without inventing anything. This file is documentation; the skill does not read it.

## Flow

1. **Break the ad down** into quoted requirements (`pipeline/<slug>/requirements.yaml`), typed and weighted from the ad's own words.
2. **Find evidence** with `scripts/cv-evidence.ts`: approved wins and answered experience-bank questions, scored by competency tag, win theme and keyword.
3. **Show coverage**, then **interview only for missing evidence slots** (`config/competencies/<pack>.yaml`, the pack named by `competency_pack` in `profile/identity.yaml`), saving each answer to the experience bank and proposing wins for the user's yes.
4. **Write bullets** in `pipeline/<slug>/cv/bullets.yaml`, each citing `win:`, `bank:`, `history:` or `stack` refs.
5. **Lint and export**: `scripts/cv-lint.ts` checks provenance; `scripts/cv-export.ts` builds `CvData` and prints it with the in-repo exporter (`scripts/cv-pdf/`), whose verifier checks the text layer and that the ad's keywords survive extraction.

## What the lint enforces (`config/cv.yaml`, `profile/stack.yaml`)

- Every ref cites an approved win, an answered bank question, a job in history.yaml or the stack.
- Every number in a line appears in a cited source; a metric clause used at all is quoted whole.
- A cited win's "contributed to" stays.
- Strength verbs (led, owned, mentored...) appear in a source, or the user confirmed them (`strength_ok_by: user`).
- A line cites only sources from its own job.
- No `never_say` phrase, no `do_not_claim` pattern, no seniority word in the headline that the user has not held as a title, no skill outside `stack.yaml`.
- A limited stack item (`{name, roles, claim_as}`) appears bare only in the tech list of a job in its `roles`; in the skills list and other jobs' tech lists it is written as its `claim_as` (ADR 0001).
- Warnings: jobs left out, tech outside the stack, bullet counts.

## Research behind it

| Finding | Source |
| --- | --- |
| HiredScore grades resumes on how well they match "the skills and qualifications specified in the job description". | [Workday HiredScore grades](https://doc.workday.com/hiredscore/en-us/workday-hiredscore/recruiter-productivity-/concept--hiredscore-grades.html) |
| Greenhouse Talent Matching: "a longer list of matched terms doesn't always mean a higher match score"; no auto-reject. | [Greenhouse Talent Matching FAQ](https://support.greenhouse.io/hc/en-us/articles/41131886674075-Talent-Matching-FAQ) |
| Workday's skills match ignores how long or how recently a skill was used. | [Workday candidate skills match](https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/candidates/candidate-skills-match/bmj1604095304483.html) |
| RChilli tags each skill with the section it came from and derives experience months and last use. | [RChilli help](https://help.rchilli.com/hc/en-us/articles/48254955870233-How-Do-I-Know-if-My-Resume-Parsing-is-Correctly-Capturing-Skills-from-Job-Experience) |
| Recruiters' first screen averages 7.4 seconds; clear sections and bulleted accomplishments did best. | [HR Dive on the Ladders study](https://www.hrdive.com/news/recruiters-spend-74-seconds-looking-at-your-resume/541582/) |
| Soft skills: "show how you use these skills, rather than just tell". | [IMI](https://www.theimi.org.uk/insight/how-put-soft-skills-cv) |
| Accomplishment statement: action verb, context ("actions taken, time, people involved"), result, quantified where possible. | [McMaster](https://studentsuccess.mcmaster.ca/resume-accomplishment-statements/) |
| "Accomplished [X] as measured by [Y], by doing [Z]". | [Inc. via UT Law](https://law.utexas.edu/wp-content/uploads/sites/44/2020/09/Google-Recruiters-Say-Using-the-X-Y-Z-Formula-on-Your-Resume-Will-Improve-Your-Odds-of-Getting-Hired-at-Google-_-Inc.com_.pdf) |
| Where results are hard to measure, count people, training, retention. | [Hays UK](https://www.hays.co.uk/career-advice/article/add-quantifiable-results-to-cv) |
| Assessors look for "the actions and activities you have undertaken". | [Registers of Scotland, Success Profiles](https://www.ros.gov.uk/about/careers/success-profiles/behaviours) |
| Staff-level architects lead with "limited tailwinds from bestowed organizational authority". | [Will Larson](https://lethain.com/staff-engineer-archetypes/) |
| "If you apply to three different jobs, you should be sending three different resumes." | [Tech Lead Journal #15](https://techleadjournal.dev/episodes/15/) |

Sources opened 2026-10-24.
