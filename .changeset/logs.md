---
'@four7/cli-core': minor
---

A program can keep its runs' logs and show them: `/process` writes each run behind a marker line and reads a log back by tail or by the runs since a time, and `LogFollower` follows several logs as one filtered stream. `/ui` adds `LOG_RULES`, which colours log lines, and `LogViewer`, the full-screen view of a follower.
