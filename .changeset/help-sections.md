---
'@four7/cli-core': minor
---

Help at the root, and at a group, opens with one synopsis, `fx [flags] COMMAND [ARG...]`, and lists what follows under two headings: `Commands`, the leaves and groups with `help`, `completion` and `i`, then `Flags`, the globals with `-h/--help`. Each command's own grammar is on its own help page, where a leaf lists its flags under `Flags` with the globals after them, and the usage above a parse error is the one that page opens with.

A program spec takes a `brief`, a line above the root's usage, a `description`, the paragraph below it, and a `footer` closing every help page.
