# @four7/cli-core

A core for command-line programs that run under Bun. A command plans before it runs: its planner answers a list of steps, which `--dry-run` prints and a run executes, or an action that does the work itself. The program runner gives every program the same globals, help, usage errors, shell completion, lazily loaded groups, full-screen Ink views and an interactive builder that fills in a command field by field.

It is the core of `f7`, the operator CLI of the four-seven monorepo, and it imports nothing of it.

## Install

```sh
bun add @four7/cli-core @optique/core ink react zod
```

[Optique](https://optique.dev) parses the command line, Ink and React draw the screens and zod validates the config. They are peer dependencies, so a program shares one copy of each with the package. The package runs under Bun only: it reads TOML and spawns processes through Bun's APIs, and `/testing` is written for `bun test`.

## A program

```ts
import { commands, defineProgram } from '@four7/cli-core';
import type { Context } from '@four7/cli-core';
import { defineConfig, verbatim } from '@four7/cli-core/config';
import { object } from '@optique/core/constructs';
import { argument } from '@optique/core/primitives';
import { string } from '@optique/core/valueparser';
import { z } from 'zod';

interface NotesContext extends Context {
	readonly file: string;
}

const { leaf, group } = commands<NotesContext>();

const config = defineConfig({
	name: 'nt',
	envPrefix: 'NT_',
	schema: z
		.strictObject({ file: z.string().default('notes.txt') })
		.prefault({}),
	variables: { FILE: { path: ['file'], read: verbatim } },
});

const add = leaf(
	'add',
	'Add a note.',
	object({ text: argument(string({ metavar: 'TEXT' })) }),
	({ text }, ctx) =>
		Promise.resolve({
			steps: [
				{
					title: 'Append the note',
					cwd: ctx.root,
					argv: ['sh', '-c', 'echo "$1" >> "$2"', 'sh', text, ctx.file],
				},
			],
		}),
);

const list = leaf('list', 'List the notes.', object({}), () =>
	Promise.resolve({
		readOnly: true,
		describe: () => ['print the notes'],
		run: async (ctx: NotesContext) => {
			ctx.stdout.write(await Bun.file(ctx.file).text());
			return 0;
		},
	}),
);

const nt = defineProgram<NotesContext, typeof config.defaults>({
	name: 'nt',
	commands: [group('notes', 'Keep notes.', add, list)],
	config,
	session: run => ({
		context: base => ({
			...base,
			root: process.cwd(),
			file: run.config().file,
		}),
	}),
});

process.exitCode = await nt.run(process.argv.slice(2));
```

`nt notes add 'a note'` runs the step, `nt --dry-run notes add 'a note'` prints it, and `nt i notes` builds the command interactively. The config is read from `$XDG_CONFIG_HOME/nt/config.toml` (or `~/.config/nt/config.toml`, or the file `--config` names), and `NT_FILE` overrides its `file`.

## Entry points

| Import | Holds |
|--------|-------|
| `@four7/cli-core` | The command model (`commands<C>()`, plans, actions), the program runner (`defineProgram`), confirmation, errors, exit codes and logging |
| `/config` | `defineConfig`: a TOML file under the config home, overlaid by a prefix's variables, validated by a zod schema |
| `/process` | The plan runner, spawning, signals, ports, health checks, finding a program on PATH, and named checks run at once and reported in order |
| `/screen` | The Ink screen host: `presentView`, `assertTerminal`, `awaitKey` |
| `/ui` | The component library: atoms, molecules, hooks, glyphs and hints |
| `/builder` | The interactive builder a program's `i` leaf opens |
| `/testing` | Captured streams, a stdin that claims to be a terminal, stubbed tools, free ports, a screen driver and `runCaptured` |

`/screen` and `/ui` load Ink and React. The root and `/config` don't, so a program that never draws a screen never loads them.

## Development

```sh
bun install
bun run type-check
bun run lint          # oxlint, type-aware, warnings denied, with the house rules in tools/lint/four7.mts
bunx oxfmt --check
bun run knip
bun run test          # the package's tests and the house rules' tests
bun run build         # dist/: the JavaScript and declarations the package publishes
bun run consumer      # the packed package installed under pnpm outside the repository, type-checked and tested as a program uses it
```

`.github/workflows/ci.yaml` runs each of these on every pull request. To work on the package against a program that uses it, run `bun link` here and `bun link @four7/cli-core` in the program, then `bun run build` after each change. The program imports `dist/`, not the source.

## Releasing

A change a release should mention adds a changeset (`bunx changeset`). On `main`, `.github/workflows/release.yaml` gathers the pending changesets into a version pull request; merging it publishes the new version to npm with provenance, through npm's trusted publishing.
