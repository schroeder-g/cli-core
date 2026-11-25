---
'@four7/cli-core': minor
---

`/process` supervises a program's long-running processes: `supervise` runs them in the foreground and forwards a signal to their groups with a grace period, `launchDetached` leaves them running in a `recordFile` that knows each pid by its start time, and `stopRecorded` ends them by it. `stopGroup`, `awaitListening`, `listenWithRetry` and `DependencyGate` are there for a program that drives its processes itself.

`until` and `waitForPort` answer false for a wait called off before it began, and `kill` on a detached child whose group has gone does nothing.
