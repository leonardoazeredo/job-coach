# Pipeline

One folder per role: `pipeline/<slug>/`.

| File | Written by | Holds |
| --- | --- | --- |
| `record.yaml` | job-intake, pipeline-update | Structured fields, status, fit, tier, dates, contacts (template in `_templates/`) |
| `jd.md` | job-intake | The job ad exactly as pasted |
| `events.md` | pipeline-update | Append-only dated log (template in `_templates/`) |
| `research.md` | company-research | Sourced company facts |
| `answers.md` | application-writer | Form answers as submitted |
| `battle-card-<date>.md` | interview-prep | Prep for one interview |
| `transcript-<date>.md` or `notes-<date>.md`, `debrief-<date>.md` | interview-debrief | Interview record and analysis |
| `offer/` | offer-review | Offer terms and documents |
| `requirements.yaml` | cv-for-role | The ad broken into quoted requirements, with evidence refs and gaps |
| `cv/bullets.yaml` | cv-for-role | The tailored CV's lines, each with its sources |
| `cv/cv.json`, `cv/keywords.txt`, `cv/<First>-<Last>-CV.pdf` (named from profile/identity.yaml), `cv/verify.txt` | `scripts/cv-export.ts` | Built CV data, ad keywords, the PDF and its verifier report |

The pipeline board is never stored; `node scripts/board.ts` computes it from these folders, and `node scripts/check.ts` validates every folder against `config/rules.yaml`, `profile/stack.yaml` and `profile/wins.yaml`, plus the CV files' provenance (the same checks as `node scripts/cv-lint.ts`). Statuses and their board groups are listed in `config/rules.yaml`.
