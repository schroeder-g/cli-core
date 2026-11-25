import { object } from '@optique/core/constructs';
import { optional } from '@optique/core/modifiers';
import { flag, option } from '@optique/core/primitives';
import { string } from '@optique/core/valueparser';
import { z } from 'zod';

import { hermetic, runCaptured } from '../../testing/index.ts';
import type { Run } from '../../testing/index.ts';
import type { Context } from '../command.ts';
import { defineConfig, numeral, verbatim } from '../config.ts';
import { commands } from '../program.ts';
import type { RunProgramOptions } from '../program.ts';

/** The lazy group's manifest, as help shows it before the group loads. */
export const LAZY = {
	name: 'infra',
	description: 'A group loaded on demand.',
	leaves: { up: 'Bring it up.', down: 'Take it down.' },
};

const nothing = () => Promise.resolve({ steps: [] });

const environment = option('-e', '--env', string({ metavar: 'ENV' }));

const services = option(
	'-s',
	'--service',
	string({ metavar: 'SERVICES' }),
);

export const config = defineConfig({
	name: 'fixture',
	envPrefix: 'FIXTURE_',
	schema: z
		.strictObject({
			greeting: z.string().default('hello'),
			port: z.number().int().optional(),
		})
		.prefault({}),
	variables: {
		GREETING: { path: ['greeting'], read: verbatim },
		PORT: { path: ['port'], read: numeral },
	},
});

const { leaf, group, program } = commands(config).over();

export type FixtureConfig = typeof config.defaults;

/**
 * A program over the base context: a lazy group, a group whose leaves
 * take a valued option and a flag, and a leaf.
 */
export const fixture = program({
	name: 'fx',
	brief: 'Fixes things.',
	description: 'A fixture over every kind of command the core offers.',
	footer: 'Each command explains itself under fx help COMMAND.',
	commands: [
		{
			manifest: LAZY,
			load: () =>
				group({
					name: LAZY.name,
					description: LAZY.description,
					commands: [
						leaf({
							name: 'up',
							description: LAZY.leaves.up,
							args: object({ environment }),
							plan: nothing,
						}),
						leaf({
							name: 'down',
							description: LAZY.leaves.down,
							plan: nothing,
						}),
					],
				}),
		},
		group({
			name: 'dev',
			description: 'Run it here.',
			commands: [
				leaf({
					name: 'start',
					description: 'Start it.',
					args: object({
						services: optional(services),
						fresh: flag('--fresh'),
					}),
					plan: nothing,
				}),
				leaf({ name: 'stop', description: 'Stop it.', plan: nothing }),
			],
			screen: ctx => {
				ctx.stdout.write('the dev screen\n');
				return 0;
			},
		}),
		leaf({
			name: 'doctor',
			description: 'Check it.',
			args: object({ environment: optional(environment) }),
			plan: nothing,
		}),
	],
	session: () => ({
		context: base => ({ ...base, root: process.cwd() }),
	}),
});

/** One run of the fixture off a terminal, hermetic to the home's config. */
export const run = (
	argv: readonly string[],
	opts: RunProgramOptions<Context, FixtureConfig> = {},
): Promise<Run> =>
	runCaptured(fixture.run, argv, {
		load: hermetic(config),
		...opts,
	});
