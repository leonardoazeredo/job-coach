# Commands take their workspace; the root stays where the script lives

Each command is a function of its arguments and a workspace that returns its exit code. The script runs it when started by node, and tests run it in-process on a temp repo; one test spawns the real scripts with a usage error, since only a spawn runs the `import.meta.main` line. A root env var, a `--root` flag and the cwd were rejected: each lets a command or the pre-commit check open another repo, and spawning, not copying, was the cost. ADR 0003 stands.
