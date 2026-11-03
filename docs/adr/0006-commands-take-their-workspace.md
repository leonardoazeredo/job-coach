# Commands take their workspace; the root stays where the script lives

## Signature

A command is a function that prints and returns its exit code, so a test runs it in-process on a temp repo. What it takes depends on what it works on, and there are two forms:

- **A command over the records** takes `(args, workspace)`: `board`, `check`, `cv-build`, `cv-evidence`, `cv-export`, `cv-lint`, `discovery/shortlist`. It reads only through the `Workspace`, which is `lib/workspace.ts`'s one view of the role folders, profile and config, so every command reports the same problems. `discovery/pull` is the same form plus a trailing `deps` for the network. The type is `Command` in `lib/workspace.ts`.
- **A command over the folder itself** takes `(args, root, deps?)`: `save` and `update`. They work on the folder as a tree of files and, for `save`, its version history, not on records, and a `Workspace` has nothing to give them. They need a path to act on and injected effects (the history tool, the archive download, the clock, the process runner) so a test can fake them. They stay out of the `Command` type for that reason and must not be folded into it: a `Workspace` carrying a path and a process runner would be a wide interface that every record command would then see.

A new command picks the form by that test: if it reads records, it takes a `Workspace`; if it changes or inspects the folder as files, it takes a root. Both end the same way: the entry line `if (import.meta.main)` opens the real workspace or `repoRoot()` and sets `process.exitCode`. Only a spawn runs that line, so one test spawns every script with a usage error. ADR 0003 stands: the command owns its printing and exit code.

## `--root`

`check.ts` alone takes `--root <dir>`, resolved against the checkout, and opens that directory as its workspace instead of the checkout. It exists because the engine ships no profile, so the checkout itself cannot pass `check`; CI (`npm run examples:check`, and the pre-commit hook when no `profile/identity.yaml` exists) and `update` (`recordCheck`, before and after it replaces files) check `examples/austin-backend` through it. `recordCheck` runs `check.ts --root` as a child process, the only way `update`, a root command, reaches the record check.

It is bounded to that one use:

- It is a flag of the script's entry line only. `check` itself still takes `(args, workspace)` and never sees the flag, so a test or another command cannot reach a second repo through it.
- It skips the visibility probe, because an example folder has no remote of its own and the probe would report the checkout's origin, the public template. A root outside the checkout therefore loses the public-repo warning as well; `--root` is not for checking a user's data.
- No other command takes it. A command that wants to act on another workspace is a new decision, not a copy of this flag.

## Rejected

A root env var, a `--root` flag on every command and the cwd as the root were rejected as the way to pick the workspace: each lets any command, or the pre-commit check, open another repo without anyone deciding to, and spawning, not copying, was the cost. `check.ts --root` is the one exception, chosen over a second entry script or a `check` variant for the example because CI and `update` need the same checks, run the same way, on the persona.
