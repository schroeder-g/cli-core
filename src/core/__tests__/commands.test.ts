import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';

import { object } from '@optique/core/constructs';
import { argument } from '@optique/core/primitives';
import { string } from '@optique/core/valueparser';
import { z } from 'zod';

import { defineConfig, verbatim } from '../config.ts';
import { commands } from '../../index.ts';
import type { Context } from '../../index.ts';
import { hermetic, runCaptured, stdin } from '../../testing/index.ts';
import type { Secret } from '../plan.ts';

/** Whether `A` and `B` are one type, as the compiler judges it. */
type Equal<A, B> =
	(<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
		? true
		: false;

interface GreetContext extends Context {
	readonly greeting: string;
}

const config = defineConfig({
	name: 'greet',
	envPrefix: 'GREET_',
	schema: z
		.strictObject({ greeting: z.string().default('hello') })
		.prefault({}),
	variables: { GREETING: { path: ['greeting'], read: verbatim } },
});

const { leaf, group, program } = commands(config).over<GreetContext>();

const greet = leaf({
	name: 'greet',
	description: 'Greet someone.',
	args: object({ who: argument(string({ metavar: 'WHO' })) }),
	plan: ({ who }, ctx) => ({
		steps: [
			{ title: 'Greet', cwd: '.', argv: ['echo', ctx.greeting, who] },
		],
	}),
});

const wave = leaf({
	name: 'wave',
	description: 'Wave.',
	plan: () => ({
		describe: () => ['wave'],
		run: ctx => {
			ctx.stdout.write('o/\n');
			return 0;
		},
	}),
});

const token: Secret = { ref: 'the token', resolve: () => 'sesame' };

const open = leaf({
	name: 'open',
	description: 'Open up.',
	plan: () => ({
		steps: [
			{
				title: 'Skipped',
				cwd: '.',
				argv: ['echo', 'skipped'],
				unless: { describe: 'always', check: () => true },
			},
			{ title: 'Say it', cwd: '.', argv: ['echo', token] },
		],
	}),
});

const later = group(
	'later',
	'Loaded when asked.',
	leaf({ name: 'up', description: 'Up.', plan: () => ({ steps: [] }) }),
	leaf({
		name: 'down',
		description: 'Down.',
		plan: () => ({ steps: [] }),
	}),
);

const greeter = program({
	name: 'gr',
	commands: [
		group('say', 'Say things.', greet, wave, open),
		{
			manifest: {
				name: 'later',
				description: 'Loaded when asked.',
				leaves: { up: 'Up.', down: 'Down.' },
			},
			load: () => later,
		},
	],
	screens: [
		{
			group: 'say',
			open: ctx => {
				ctx.stdout.write(`${ctx.greeting} from the screen\n`);
				return 0;
			},
		},
	],
	session: run => ({
		context: base => ({
			...base,
			root: tmpdir(),
			greeting: run.config().greeting,
		}),
	}),
});

type SessionConfig = ReturnType<
	Parameters<Parameters<typeof program>[0]['session']>[0]['config']
>;

const run = (argv: readonly string[], env = {}) =>
	runCaptured(greeter.run, argv, { load: hermetic(config, env) });

describe('a program built from its commands', () => {
	test("its config's type is the one the config's schema gives", () => {
		const inferred: Equal<SessionConfig, { greeting: string }> = true;
		expect(inferred).toBe(true);
	});

	test('a leaf takes its name, description, args and planner as one object', async () => {
		const help = await run(['help', 'say']);
		expect(help.stdout).toMatch(/greet\s+Greet someone\./);
		const planned = await run(['--dry-run', 'say', 'greet', 'ada'], {
			GREET_GREETING: 'hi',
		});
		expect(planned.code).toBe(0);
		expect(planned.stdout).toContain('$ echo hi ada');
	});

	test('a leaf given no args takes nothing', async () => {
		expect(await run(['say', 'wave'])).toMatchObject({
			code: 0,
			stdout: 'o/\n',
		});
		expect((await run(['say', 'wave', 'extra'])).code).toBe(2);
		expect((await run(['say', 'wave', '--loud'])).code).toBe(2);
	});

	test('a planner answers a plan or an action as it is, unawaited', async () => {
		const ran = await run(['say', 'greet', 'ada']);
		expect(ran.code).toBe(0);
		expect(ran.stdout).toBe('hello ada\n');
		const described = await run(['--dry-run', 'say', 'wave']);
		expect(described).toMatchObject({ code: 0, stdout: 'wave\n' });
	});

	test("a step's check and a secret answer as they are, unawaited", async () => {
		expect(await run(['say', 'open'])).toMatchObject({
			code: 0,
			stdout: 'sesame\n',
		});
	});

	test('a lazy group loads as it is, unawaited', async () => {
		const planned = await run(['--dry-run', 'later', 'up']);
		expect(planned.code).toBe(0);
	});

	test('a screen answers its code as it is, unawaited', async () => {
		const opened = await runCaptured(greeter.run, ['say'], {
			load: hermetic(config),
			stdin: stdin({ tty: true }),
		});
		expect(opened).toMatchObject({
			code: 0,
			stdout: 'hello from the screen\n',
		});
	});
});
