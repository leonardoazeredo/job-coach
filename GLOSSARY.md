# Job pipeline

The job hunt of one person, the user: the roles they track, what they can truthfully claim, and the material built from those claims.

## Pipeline

**Role**:
One job opening being tracked, identified by its slug and kept in its own folder.
_Avoid_: job (that is a past employment), opening, posting ("ad" is the posting itself)

**Slug**:
The short name that identifies a role and names its folder. Wins have slugs too and are always referred to by them.

**Role folder**:
The folder that holds everything about one role, named after its slug: always its record and events, and once a CV is tailored, its requirements, its variant and the CV built from them.
_Avoid_: role directory, pipeline folder

**Record**:
The current state of a role: company, title, status, fit, dates and stack matches.

**Event**:
One dated thing that happened to a role, such as applying, an interview or a rejection, named from the fixed list in `config/rules.yaml` `events`. A role's events are its history; the record is its present.

**Status**:
Where a role stands in its lifecycle, drawn from a fixed list.
_Avoid_: stage, state

**Applied status**:
A status that can only be reached by applying, so the role must carry an applied date. Listed in `config/rules.yaml` `implies_applied`. Rejected and Withdrawn are not applied statuses, because a role can end that way before an application.

**Board group**:
One of the sections of the pipeline board that every status belongs to exactly once.

## Claims

**Stack**:
The technologies the user can claim, sorted into stack sections by how deeply they know them.

**Stack section**:
One of core, secondary, past or tools: how deeply a stack item is known.
_Avoid_: tier (a tier is a role's priority, 0 to 2)

**Tier**:
A role's priority, from 0 (career maker) to 2 (standard senior role).

**Gap**:
A technology a role requires that is not in the stack.

**Limit**:
A restriction on how a stack item may be claimed, such as "coursework only" or "report generation only". An item with a limit appears bare only under the roles where it happened, and everywhere else only with its limit stated.

**Claimable**:
Allowed to appear in outward material: in the stack, stated within its limit, and not a do-not-claim item.

## Sources

**Source**:
One thing a CV line may cite for what it says: a win, a bank question, a job in the user's history, or the stack.

**Job**:
One past employment in the user's history, with the public title, dates and employment type a CV may state. Wins and bank questions each belong to one job.
_Avoid_: history role, position, role (a role is a tracked opening)

**Source ref**:
The short string a CV line writes to cite one source, naming the source's kind and which one.
_Avoid_: citation, source id, reference, link

**Citable**:
A source a line may cite now: an approved win, an answered bank question, any job, or the stack. A proposed win or an unanswered question is a source that is not yet citable.
_Avoid_: claimable (that is for stack items), resolvable, valid

**Win**:
One achievement with its exact metric and the action behind it, belonging to one job. Approved wins are citable; proposed ones wait for the user's yes.
_Avoid_: achievement, accomplishment, result

**Never-say phrase**:
An inflation of a win seen in a past draft, listed on that win so no outward material repeats it.
_Avoid_: banned phrase, blocklist

**Experience bank**:
The user's first-hand answers about one job, kept as numbered questions, from which wins and CV lines are drawn.

**Bank question**:
One numbered question in the experience bank. It is answered once it carries a summary, and only then is it citable.
_Avoid_: entry, story, answer (the answer is part of the question)

**Recent job**:
One of the newest few jobs in the user's history, which take the fuller bullet range on a CV. How many count as recent is a CV rule, not a fact about the history.

## Tailored CVs

**Profile**:
The material every CV draws on and is checked against: the user's wins, history, experience bank and stack, the competencies, the CV rules and the master CV.

**Master CV**:
The full, untailored CV that every tailored CV is built from.

**Requirements**:
The asks in one role's ad, each with a status (covered, partial, gap, not-claimable or dropped) saying how far the evidence answers it.
_Avoid_: criteria, must-haves, job spec

**Evidence**:
A citable source, a win or an experience-bank answer, that supports a requirement. The evidence search proposes it; the requirements record what was chosen.

**Variant**:
The bullets chosen for one role, each citing its evidence and the requirements it answers. The tailored CV is built from the variant and the master CV.
_Avoid_: bullets file, tailored CV (that is the built output)

**Line**:
One sourced sentence of a Variant, the summary or a job's bullet, named by where it appears (`summary`, `brightwell bullet 2`).
_Avoid_: entry, bullet (only job lines are bullets)

**CV text**:
Everything a built CV says, as the PDF prints it, apart from the contact details and dates. Keywords are credited from it, and never-say phrases and do-not-claim items are checked against it.
_Avoid_: visible text, all text

**Role CV**:
Everything tailored for one role: its requirements, its variant, the CV built from them, its keywords and the exported files.

## Checking

**Workspace**:
The repo's data opened at one root: the role folders, the profile and the config, read under one policy so every command reports the same problems.
_Avoid_: repo, root (the root is where a workspace is opened)

**Problem**:
One thing a check found wrong, at error or warning level, named by the slug of the role it concerns or by the path of the file when it concerns no one role. An error blocks the command and any write; a warning is listed for the user to decide.
_Avoid_: issue (that is a GitHub issue), failure, diagnostic, violation

**Missing**:
A file or folder that is not there. A missing record or events file is a problem; missing requirements or a missing variant is a fact until an operation needs the file.
_Avoid_: absent, not found

**Unreadable**:
A file that is there but cannot be read as the file it should be: bad YAML or JSON, a schema failure, or a role name that differs from its folder. Always a problem.
_Avoid_: malformed, invalid, broken, corrupt

**Command**:
One of the programs under `scripts/` run with `node`. It reads its arguments, asks the workspace it is given, decides what to show and which exit code to give; it holds no check of its own.
_Avoid_: entry script, CLI, tool

## Discovery

**Discovery**:
Finding listings worth triaging: pulling job boards, then shortlisting what they returned.

**Job board**:
A site that lists openings and that discovery pulls from.
_Avoid_: source (a citable source), site

**Listing**:
One opening as a job board shows it, with company, title and url and whatever else the board knows. The card, not the full ad.
_Avoid_: row, job, candidate, posting

**Via**:
The applicant tracking system a job board found a listing on, such as `ashby` or `teamtailor`. A board that does not report it leaves it unset, as Rocketship does.
_Avoid_: source (a citable source)

**Pull**:
One fetch of a board's listings, saved as a file so a shortlist can be made again without the network.
_Avoid_: listing file, pool

**Search title**:
A title a title-searched board is asked for: the `search_titles` in `profile/search.yaml` plus the title expansion.
_Avoid_: seed

**Title expansion**:
Titles that count as relevant to the user's field without saying so, listed in `profile/search.yaml` `discovery.title_expansion`. A last word "Engineer" also admits "Engineering" ("Product Engineer" admits "Product Engineering Lead"). A missed title form is added to that list first; the pattern changes only for a class of titles that can't be listed.

**Qualifying title**:
A title worth shortlisting: it names a term of the user's field or an expansion title, and none of the excluded words. An unclear title is let in, because a shortlist is read by a person and a dropped listing is never seen. A full-stack title qualifies only through an explicit front-end term or an expansion title; a language or framework alone doesn't outweigh full-stack.
_Avoid_: relevant, field-relevant

**Expired listing**:
A listing posted more than `fresh_days` before today. An undated listing never expires.
_Avoid_: stale (an applied role with no reply), old

**Duplicate listings**:
Listings with the same normalised company and title, from one board or several. One is kept and carries the others' count and boards.

**Listing match**:
The pipeline's answer for a listing: tracked (a role with that company and title), company (roles at that company, none with that title) or new.
_Avoid_: pipeline, hit

**Shortlist**:
The listings left after dedupe, qualification and expiry, each with its match, in the order triage reads them, together with what was dropped and why.
_Avoid_: triage (the screening that gives each role a verdict), merge, candidates

## Saving and updates

**Engine**:
Everything shipped by `leonardoazeredo/job-coach`: scripts, skills, config defaults, templates, docs and the core prompt. Under `pipeline/` and `experience-bank/`, only the README and `pipeline/_templates/` are engine files.
_Avoid_: template (the GitHub button that copies it), app

**User data**:
The four folders the engine never ships: `profile/`, `cv/`, `pipeline/` and `experience-bank/`.
_Avoid_: workspace (the folders a command reads, which can be the worked example)

**History**:
A git checkout whose top level is the folder itself. A ZIP download, a folder unpacked inside another checkout, or a computer without git keeps none.
_Avoid_: repo (in anything the user reads)

**Save**:
A commit of the user data with a plain message, made by `scripts/save.ts` after each write, then a push to an online copy that is not public. Without history, nothing happens.
_Avoid_: commit, backup (a backup is the copy a ZIP update keeps)

**Coach update**:
Bringing the engine up to the newest upstream version: a merge in a folder with history, or a copy over the engine files with backups in `.coach/backups/` in one without.
_Avoid_: pipeline update (recording a change to a role)

## Tests

**Worked example**:
The fictional persona in `examples/austin-backend`, with a role whose requirements and CV pass every check. CV checks are proven against it, so they stay stable whatever data a user keeps.
_Avoid_: fixture (too broad: the frozen profile alone is not the worked example)

**Temp repo**:
A throwaway repo laid out like a user's, copied from the persona and the engine rules, that a test fills with roles, reads back and runs commands against in-process.
_Avoid_: fixture root, test root, temp dir
