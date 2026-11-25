---
'@four7/cli-core': minor
---

A `/git` entry point: `findRoot` locates a program's root without running anything, git queries read the checkout, `scratchWorktree` plans a locked scratch worktree's add and remove, and `assertGate` holds a command to its branches and a clean tree. `ProgramSpec.root` locates the root lazily, once per run, never for help or completion. `capture` takes secrets in argv and env, `captureOrFail` answers stdout or a `Failure` (or nothing for an absent pattern), and `formatCapture` prints a capture for a dry run. `/testing` makes scratch directories and repositories under an isolated git config.
