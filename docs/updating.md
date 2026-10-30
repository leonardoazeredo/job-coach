# Updating from upstream

A copy made with **Use this template** starts with its own history, so it does not follow `leonardoazeredo/job-coach` on its own. Engine updates (scripts, skills, config defaults, schemas, docs) are pulled in with git.

Once, in your copy:

```
git remote add upstream https://github.com/leonardoazeredo/job-coach.git
gh repo set-default <you>/<your-copy>    # only if you use the gh CLI
```

The second line matters if you use `gh`. When there is a remote named `upstream`, `gh` treats it as the default repository, so `gh issue` commands would otherwise go to the public job-coach repository instead of your private copy.

Each time you update:

```
git fetch upstream
git merge upstream/main      # the first time: git merge --allow-unrelated-histories upstream/main
npm ci
npm run ci
```

The first merge needs `--allow-unrelated-histories`, because a template copy shares no commits with upstream. After that, plain `git merge upstream/main` works.

## What conflicts, and why

At the repo root, upstream ships no `profile/`, `cv/` or `pipeline/<slug>/`, and `experience-bank/` holds only its README, so your data does not conflict. `examples/` is fictional and does ship. Conflicts come from engine files you changed yourself: most often `config/rules.yaml`, a competency pack or a skill, and sometimes `pipeline/README.md`, `pipeline/_templates/` or `experience-bank/README.md`. Keep your edit or take upstream's, then check before committing the merge: `npm run pipeline:check` once onboarding has created `profile/`, or `npm run examples:check` before that.

If you changed an engine file to fix a bug, report it as an issue on `leonardoazeredo/job-coach`. Once a fix is merged upstream, your next merge brings it in, and you can drop your local edit in favour of upstream's.
