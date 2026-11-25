---
'@four7/cli-core': patch
---

A program whose commands are all leaves builds and runs. It has no `i` leaf, since the builder opens at a group and there is none; before, the program threw at startup over the empty list of group names.
