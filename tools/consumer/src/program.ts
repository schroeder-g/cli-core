import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { commands, defineProgram } from '@four7/cli-core';
import type { Context } from '@four7/cli-core';
import { defineConfig, verbatim } from '@four7/cli-core/config';
import { presentView } from '@four7/cli-core/screen';
import { object } from '@optique/core/constructs';
import { argument } from '@optique/core/primitives';
import { string } from '@optique/core/valueparser';
import { z } from 'zod';

export interface NotesContext extends Context {
	readonly file: string;
}

const { leaf, group } = commands<NotesContext>();

export const config = defineConfig({
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
			ctx.stdout.write(
				await readFile(join(ctx.root, ctx.file), 'utf8'),
			);
			return 0;
		},
	}),
);

export const nt = defineProgram<NotesContext, typeof config.defaults>({
	name: 'nt',
	commands: [
		group('notes', 'Keep notes.', add, list),
		{
			manifest: {
				name: 'sync',
				description: 'Sync the notes.',
				leaves: { push: 'Push them.', pull: 'Pull them.' },
			},
			load: () =>
				Promise.resolve(
					group(
						'sync',
						'Sync the notes.',
						leaf('push', 'Push them.', object({}), () =>
							Promise.resolve({
								steps: [{ title: 'Push', cwd: '.', argv: ['true'] }],
							}),
						),
						leaf('pull', 'Pull them.', object({}), () =>
							Promise.resolve({ steps: [] }),
						),
					),
				),
		},
	],
	screens: [
		{
			group: 'notes',
			open: async ctx => {
				await presentView<void, { onDone: () => void }>(
					ctx,
					'nt notes needs a terminal.',
					() => import('./View.tsx'),
					'View',
					exit => ({ onDone: () => exit.done() }),
				);
				return 0;
			},
		},
	],
	config,
	session: run => ({
		context: base => ({
			...base,
			root: process.cwd(),
			file: run.config().file,
		}),
	}),
});
