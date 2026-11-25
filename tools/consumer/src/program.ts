import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { commands } from '@four7/cli-core';
import type { Context } from '@four7/cli-core';
import { argument, object, string } from '@four7/cli-core/args';
import { defineConfig, verbatim, z } from '@four7/cli-core/config';
import { presentView } from '@four7/cli-core/screen';
import type { Exit } from '@four7/cli-core/screen';

export interface NotesContext extends Context {
	readonly file: string;
}

export const config = defineConfig({
	name: 'nt',
	envPrefix: 'NT_',
	schema: z
		.strictObject({ file: z.string().default('notes.txt') })
		.prefault({}),
	variables: { FILE: { path: ['file'], read: verbatim } },
});

const { leaf, group, program } = commands(config).over<NotesContext>();

const add = leaf({
	name: 'add',
	description: 'Add a note.',
	args: object({ text: argument(string({ metavar: 'TEXT' })) }),
	plan: ({ text }, ctx) =>
		Promise.resolve({
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
	plan: () =>
		Promise.resolve({
			readOnly: true,
			describe: () => ['print the notes'],
			run: async (ctx: NotesContext) => {
				ctx.stdout.write(
					await readFile(join(ctx.root, ctx.file), 'utf8'),
				);
				return 0;
			},
		}),
});

export const nt = program({
	name: 'nt',
	commands: [
		group({
			name: 'notes',
			description: 'Keep notes.',
			commands: [add, list],
		}),
		{
			manifest: {
				name: 'sync',
				description: 'Sync the notes.',
				leaves: { push: 'Push them.', pull: 'Pull them.' },
			},
			load: () =>
				Promise.resolve(
					group({
						name: 'sync',
						description: 'Sync the notes.',
						commands: [
							leaf({
								name: 'push',
								description: 'Push them.',
								plan: () =>
									Promise.resolve({
										steps: [
											{ title: 'Push', cwd: '.', argv: ['true'] },
										],
									}),
							}),
							leaf({
								name: 'pull',
								description: 'Pull them.',
								plan: () => Promise.resolve({ steps: [] }),
							}),
						],
					}),
				),
		},
	],
	screens: [
		{
			group: 'notes',
			open: async ctx => {
				await presentView({
					io: ctx,
					refusal: 'nt notes needs a terminal.',
					view: () => import('./View.tsx').then(module => module.View),
					props: (exit: Exit<void>) => ({ onDone: () => exit.done() }),
				});
				return 0;
			},
		},
	],
	session: run => ({
		context: base => ({
			...base,
			root: process.cwd(),
			file: run.config().file,
		}),
	}),
});
