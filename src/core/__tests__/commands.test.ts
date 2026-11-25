import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';

import { argument, object, string } from '../../args/index.ts';
import { defineConfig, verbatim, z } from '../config.ts';
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

const loud = group({
	name: 'loud',
	description: 'Say things loudly.',
	commands: [
		leaf({
			name: 'shout',
			description: 'Shout.',
			plan: () => ({ steps: [] }),
		}),
		leaf({
			name: 'roar',
			description: 'Roar.',
			plan: () => ({ steps: [] }),
		}),
	],
	screen: ctx => {
		ctx.stdout.write(
			`${ctx.greeting.toUpperCase()} from the loud screen\n`,
		);
		return 0;
	},
});

const later = group({
	name: 'later',
	description: 'Loaded when asked.',
	screen: ctx => {
		ctx.stdout.write('the later screen\n');
		return 0;
	},
	commands: [
		leaf({
			name: 'up',
			description: 'Up.',
			plan: () => ({ steps: [] }),
		}),
		leaf({
			name: 'down',
			description: 'Down.',
			plan: () => ({ steps: [] }),
		}),
	],
});

const greeter = program({
	name: 'gr',
	commands: [
		group({
			name: 'say',
			description: 'Say things.',
			commands: [greet, wave, open, loud],
			screen: ctx => {
				ctx.stdout.write(`${ctx.greeting} from the screen\n`);
				return 0;
			},
		}),
		{
			manifest: {
				name: 'later',
				description: 'Loaded when asked.',
				leaves: { up: 'Up.', down: 'Down.' },
			},
			load: () => later,
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

const onTerminal = (argv: readonly string[]) =>
	runCaptured(greeter.run, argv, {
		load: hermetic(config),
		stdin: stdin({ tty: true }),
	});

describe('a program of leaves alone', () => {
	const flat = program({
		name: 'fl',
		commands: [greet, wave],
		session: run => ({
			context: base => ({
				...base,
				root: tmpdir(),
				greeting: run.config().greeting,
			}),
		}),
	});

	const runFlat = (argv: readonly string[]) =>
		runCaptured(flat.run, argv, { load: hermetic(config) });

	test('builds and runs its leaves', async () => {
		const planned = await runFlat(['--dry-run', 'greet', 'ada']);
		expect(planned.code).toBe(0);
		expect(planned.stdout).toContain('$ echo hello ada');
	});

	test('has no builder leaf, since there is no group to build at', async () => {
		const help = await runFlat(['--help']);
		expect(help.code).toBe(0);
		expect(help.stdout).toMatch(/\n  greet\s/);
		expect(help.stdout).not.toMatch(/\n  i\s/);
		const builder = await runFlat(['i']);
		expect(builder.code).toBe(2);
		expect(builder.stderr).toMatch(/Error: .*\bi\b/);
	});
});

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

	test("a group's screen opens for the group named alone on a terminal, answering its code as it is, unawaited", async () => {
		expect(await onTerminal(['say'])).toMatchObject({
			code: 0,
			stdout: 'hello from the screen\n',
		});
	});

	test("a nested group's screen opens for its path named alone", async () => {
		expect(await onTerminal(['say', 'loud'])).toMatchObject({
			code: 0,
			stdout: 'HELLO from the loud screen\n',
		});
	});

	test("a lazy group's screen opens once the group has loaded", async () => {
		expect(await onTerminal(['later'])).toMatchObject({
			code: 0,
			stdout: 'the later screen\n',
		});
	});

	test('no screen opens under a dry run or a help request', async () => {
		for (const argv of [
			['--dry-run', 'say'],
			['--dry-run', 'say', 'loud'],
			['--dry-run', 'later'],
		])
			expect(await onTerminal(argv)).toMatchObject({
				code: 2,
				stdout: '',
			});
		for (const argv of [
			['say', '--help'],
			['help', 'say', 'loud'],
			['later', '--help'],
		]) {
			const help = await onTerminal(argv);
			expect(help.code).toBe(0);
			expect(help.stdout).not.toContain('screen');
			expect(help.stdout).toContain('Usage:');
		}
	});

	test('a leaf under a group with a screen runs, and opens none', async () => {
		expect(await onTerminal(['say', 'wave'])).toMatchObject({
			code: 0,
			stdout: 'o/\n',
		});
	});
});
