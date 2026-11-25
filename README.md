# @four7/cli-core

A core for command-line programs that run under Bun. A command plans before it runs: its planner answers a list of steps, which `--dry-run` prints and a run executes, or an action that does the work itself. The program runner gives every program the same globals, help, usage errors, shell completion, lazily loaded groups, full-screen Ink views and an interactive builder that fills in a command field by field.

It is the core of `f7`, the operator CLI of the four-seven monorepo, and it imports nothing of it.

## Install

```sh
bun add @four7/cli-core ink react
```

[Ink](https://github.com/vadimdemedes/ink) and React draw the screens. They are peer dependencies because a program's own components and Ink's hooks must share one React: a copy bundled with the package would be a second React, which breaks hooks at runtime while every type check passes. [Optique](https://optique.dev), which parses the command line, and [zod](https://zod.dev), which validates the config, come with the package, at the versions it is typed against; a program imports them from `/args` and `/config`. The package runs under Bun only: it reads TOML and spawns processes through Bun's APIs, and `/testing` is written for `bun test`.

## A program

```ts
#!/usr/bin/env -S bun --env-file=/dev/null
import { commands, runMain } from '@four7/cli-core';
import type { Context } from '@four7/cli-core';
import { argument, object, string } from '@four7/cli-core/args';
import { defineConfig, verbatim, z } from '@four7/cli-core/config';
import { presentView } from '@four7/cli-core/screen';

interface NotesContext extends Context {
	readonly file: string;
}

const config = defineConfig({
	name: 'nt',
	envPrefix: 'NT_',
	schema: z
		.strictObject({ file: z.string().default('notes.txt') })
		.prefault({}),
	variables: { FILE: { path: ['file'], read: verbatim } },
});

const { leaf, group, program } = commands(config).over<NotesContext>();

const notes = async ({ file }: NotesContext): Promise<string[]> =>
	(await Bun.file(file).exists())
		? (await Bun.file(file).text()).split('\n').filter(Boolean)
		: [];

const add = leaf({
	name: 'add',
	description: 'Add a note.',
	args: object({ text: argument(string({ metavar: 'TEXT' })) }),
	plan: ({ text }, ctx) => ({
		steps: [
			{
				title: 'Append the note',
				cwd: ctx.root,
				argv: ['sh', '-c', 'echo "$1" >> "$2"', 'sh', text, ctx.file],
			},
		],
	}),
});

const list = leaf({
	name: 'list',
	description: 'List the notes.',
	plan: () => ({
		readOnly: true,
		describe: () => ['print the notes'],
		run: async ctx => {
			for (const note of await notes(ctx))
				ctx.stdout.write(`${note}\n`);
			return 0;
		},
	}),
});

const tick = async (ctx: NotesContext): Promise<number> => {
	const all = await notes(ctx);
	let done: ReadonlySet<string> = new Set();
	await presentView(
		ctx,
		'nt notes needs a terminal.',
		() => import('@four7/cli-core/ui'),
		'ChecklistView',
		exit => ({
			title: 'nt',
			sub: 'tick what is done',
			items: all.map(name => ({ name })),
			initial: () => done,
			confirms: 'clears them',
			empty: 'no notes yet',
			onQuit: () => exit.done(undefined),
			onConfirm: (ticked: ReadonlySet<string>) => {
				done = ticked;
				exit.done(undefined);
				return undefined;
			},
		}),
	);
	if (done.size > 0)
		await Bun.write(
			ctx.file,
			all
				.filter(note => !done.has(note))
				.map(note => `${note}\n`)
				.join(''),
		);
	return 0;
};

const nt = program({
	name: 'nt',
	commands: [group('notes', 'Keep notes.', add, list)],
	screens: [{ group: 'notes', open: tick }],
	session: run => ({
		context: base => ({ ...base, file: run.config().file }),
	}),
});

await runMain(nt.run);
```

`commands(config)` takes the program's config, so its type is inferred, and `over` names the context its planners get, once. A leaf is one object: its name and description as help shows them, the parser of what it takes (`args`, nothing when left out) and its planner, which answers a plan of steps or an action, as it is or as a promise. `program` takes the rest of the spec, and `session` builds each run's context over the config it loaded.

`runMain` hands the program the arguments after the script's and makes the code it answers the process's, through `process.exitCode`, so what the program wrote drains before the process exits. A reader that closes early, `nt notes list | head -1`, ends the process quietly with 0. The shebang's `--env-file=/dev/null` keeps Bun from loading the working directory's `.env` into the program, which every child it spawns would inherit.

`nt notes add 'a note'` runs the step, `nt --dry-run notes add 'a note'` prints it, and `nt i notes` builds the command interactively. `nt notes` alone on a terminal opens the notes as a checklist, cli-core's `ChecklistView`; Enter clears the ticked ones. The config is read from `$XDG_CONFIG_HOME/nt/config.toml` (or `~/.config/nt/config.toml`, or the file `--config` names), and `NT_FILE` overrides its `file`.

## Entry points

| Import | Holds |
|--------|-------|
| `@four7/cli-core` | The command model (`commands(config).over<C>()`, its `leaf`, `group` and `program`, plans, actions), the program's entry (`runMain`), confirmation, errors, exit codes and logging; the dependency graph (`dependencyGraph`) and the checklist rules that close over it; a directory of named files (`namedFiles`) |
| `/args` | The parser vocabulary: Optique's constructs, modifiers, primitives, value parsers and message helpers, `parse`, `suggest` and `getDocPage`, and the types a custom value parser is written in; cli-core's option parsers (`names`, `nameList`, `timestamp`) and the selections over what they parsed (`selectNamed`, `selectOne`) |
| `/config` | `defineConfig`: a TOML file under the config home, overlaid by a prefix's variables, validated by a schema written with `z`, zod as the package re-exports it; `xdgHome`, the XDG base directories |
| `/process` | The plan runner, spawning, `capture` and `captureOrFail`, signals, ports and health checks; supervising processes in the foreground or detached into a record file, stopping a process group, knowing a pid by its start time, waiting until a child listens, gating a start on its needs; run logs and `LogFollower`, which follows several as one stream; finding a program on PATH and named checks run at once and reported in order; the action that runs a chosen plan (`chosenPlan`); opening a url and copying to the clipboard |
| `/screen` | The Ink screen host: `presentView`, `assertTerminal`, `awaitKey` |
| `/ui` | The component library: atoms, molecules, hooks, glyphs and hints, among them `Link`, `Columns`, the checklist screen (`ChecklistView`), `LOG_RULES` and `LogViewer` |
| `/builder` | The interactive builder a program's `i` leaf opens |
| `/testing` | Captured streams, a stdin that claims to be a terminal, stubbed tools, free ports, a screen driver, `runCaptured` and `hermetic`; `refused` and `writeUnder`; scratch directories and git repositories |
| `/git` | The root locator (`findRoot`), git queries, a scratch worktree's plan steps and the branch and clean-tree gate |

`/screen` and `/ui` load Ink and React. The root, `/args` and `/config` don't, so a program that never draws a screen never loads them. `/git`'s queries, worktree steps and gate run the `git` binary, which the program's machine must have on PATH; `findRoot` runs nothing.

## Development

```sh
bun install
bun run type-check
bun run lint          # oxlint, type-aware, warnings denied, with the house rules in tools/lint/four7.mts
bunx oxfmt --check
bun run knip
bun run test          # the package's tests, the house rules' tests, and the README's program held to the consumer's
bun run build         # dist/: the JavaScript and declarations the package publishes
bun run consumer      # the packed package installed under pnpm outside the repository, type-checked and tested as a program uses it, the README's program run as its user runs it
```

`.github/workflows/ci.yaml` runs each of these on every pull request. To work on the package against a program that uses it, run `bun link` here and `bun link @four7/cli-core` in the program, then `bun run build` after each change. The program imports `dist/`, not the source.

## Releasing

A change a release should mention adds a changeset (`bunx changeset`). On `main`, `.github/workflows/release.yaml` gathers the pending changesets into a version pull request; merging it publishes the new version to npm with provenance, through npm's trusted publishing.

## TODO

- Publish to [JSR](https://jsr.io) instead of npm, once JSR can serve this package to Bun. Two gaps block it today. JSR's npm layer ships `.tsx` files untranspiled ([jsr-io/jsr#996](https://github.com/jsr-io/jsr/issues/996)), so `/ui`, `/screen` and `/builder` fail on import. JSR also cannot declare Ink and React as peers ([jsr-io/jsr#880](https://github.com/jsr-io/jsr/issues/880)). Publishing will need a GitHub secret holding the JSR token that `release.yaml` publishes with.
