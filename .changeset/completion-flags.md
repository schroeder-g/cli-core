---
'@four7/cli-core': patch
---

Completion offers a command's flags, long ones included, on a lone dash, and on an empty word where no command, argument or value is offered. `drift propose <TAB>` used to offer only `-h` and `--help`, and `drift propose -<TAB>` only the global short flags.
