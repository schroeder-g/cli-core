import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { object } from '@optique/core/constructs';
import { optional } from '@optique/core/modifiers';
import { flag, option } from '@optique/core/primitives';
import { string } from '@optique/core/valueparser';
import { z } from 'zod';

import { runCaptured } from '../../testing/index.ts';
import type { Run } from '../../testing/index.ts';
import { commands } from '../command.ts';
import type { Context } from '../command.ts';
import { defineConfig, numeral, verbatim } from '../config.ts';
import { defineProgram } from '../program.ts';
import type { RunProgramOptions } from '../program.ts';

/** The lazy group's manifest, as help shows it before the group loads. */
export const LAZY = {
	name: 'infra',
	description: 'A group loaded on demand.',
	leaves: { up: 'Bring it up.', down: 'Take it down.' },
};

// A home no file is ever written under, so a run reads no config but
// what --config names.
const NO_HOME = join(tmpdir(), 'cli-fixture-no-home');

const { leaf, group } = commands<Context>();

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

export type FixtureConfig = typeof config.defaults;

/**
 * A program over the base context: a lazy group, a group whose leaves
 * take a valued option and a flag, and a leaf.
 */
export const fixture = defineProgram<Context, FixtureConfig>({
	name: 'fx',
	commands: [
		{
			manifest: LAZY,
			load: () =>
				Promise.resolve(
					group(
						LAZY.name,
						LAZY.description,
						leaf(
							'up',
							LAZY.leaves.up,
							object({ environment }),
							nothing,
						),
						leaf('down', LAZY.leaves.down, object({}), nothing),
					),
				),
		},
		group(
			'dev',
			'Run it here.',
			leaf(
				'start',
				'Start it.',
				object({
					services: optional(services),
					fresh: flag('--fresh'),
				}),
				nothing,
			),
			leaf('stop', 'Stop it.', object({}), nothing),
		),
		leaf(
			'doctor',
			'Check it.',
			object({ environment: optional(environment) }),
			nothing,
		),
	],
	screens: [
		{
			group: 'dev',
			open: ctx => {
				ctx.stdout.write('the dev screen\n');
				return Promise.resolve(0);
			},
		},
	],
	config,
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
		load: path => config.load(path, { HOME: NO_HOME }),
		...opts,
	});
