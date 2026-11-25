---
'@four7/cli-core': minor
---

`/process` finds a program on PATH (`findTool`) and refuses a run that lacks one (`preflight`). A program's named checks (`Check`, `loggedCheck` for programs run in turn to a log) run at once through `runChecks`, which reports each in the order given as `✓`/`✗ name detail — fix` and answers `FAILED` when any failed; `allInOrder` is the same concurrency for any other report.
