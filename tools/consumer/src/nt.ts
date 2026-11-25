#!/usr/bin/env -S bun --env-file=/dev/null
import { commands, runMain } from '@four7/cli-core';
import type { Context } from '@four7/cli-core';
import { argument, object, string } from '@four7/cli-core/args';
import { defineConfig, verbatim, z } from '@four7/cli-core/config';
import { checklistView, presentView } from '@four7/cli-core/screen';

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
	await presentView({
		io: ctx,
		refusal: 'nt notes needs a terminal.',
		view: checklistView,
		props: exit => ({
			title: 'nt',
			sub: 'tick what is done',
			items: all.map(name => ({ name })),
			initial: () => done,
			confirms: 'clears them',
			empty: 'no notes yet',
			onQuit: () => exit.done(undefined),
			onConfirm: ticked => {
				done = ticked;
				exit.done(undefined);
				return undefined;
			},
		}),
	});
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
	commands: [
		group({
			name: 'notes',
			description: 'Keep notes.',
			commands: [add, list],
		}),
	],
	screens: [{ group: 'notes', open: tick }],
	session: run => ({
		context: base => ({ ...base, file: run.config().file }),
	}),
});

await runMain(nt.run);
