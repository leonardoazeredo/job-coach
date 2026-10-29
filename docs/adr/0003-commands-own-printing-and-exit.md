# Commands own their printing and exit; the problem module owns the vocabulary

Every command under `scripts/` decides for itself whether to show warnings and which code to exit with, and `lib/problem.ts` holds only what they share: the `Problem` type, `hasErrors`, `printProblems`, the error-and-warning summary line, and the table of exit codes (64 for usage, 1 for problems in the data, 66 for an input missing from outside the workspace: Chrome or poppler, or a file named on the command line such as a saved pull). We do not fold printing and exit into one reporting module, because the differences between the commands are deliberate: a command about to write shows every warning, a repo-wide scan hides them behind `--warnings` until it is clean, and discovery only ever has errors. Only the command knows whether a write follows, and a module that took that as a parameter would be a two-line implementation behind a many-parameter interface. Exit codes carry meaning for the agent that runs a command, so the same failure class exits with the same code everywhere and the number has one source.

## Considered options

- **One reporting module owning counting, printing and exit** (proposed by an architecture review): rejected because the duplication is two lines per command and the variation is policy, not accident.
- **A `fail(kind, message)` helper that prints and exits**: rejected because `process.exit` inside a library module ends any test that reaches it and hides a side effect behind a call.
- **Usage exits 2, the bash and getopt convention**: rejected in favour of 64 because cv-export already documents 64 and 66 from the sysexits family, so one family covers the whole table.
