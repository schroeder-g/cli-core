import { describe, expect, mock, test } from 'bun:test';
import { tmpdir } from 'node:os';

import { fixtureTree, stdin, terminal } from '../../testing/index.ts';
import { builders } from '../builders.ts';
import type { Action, Context } from '../command.ts';
import { Failure } from '../errors.ts';
import type { Plan, Secret } from '../plan.ts';
import type { Session } from '../program.ts';
import { run } from './fixture.ts';

const SECRET_VALUE = 'hunter2';

const { leaf } = builders<Context>();

const resolveSecret = mock(() => Promise.resolve(SECRET_VALUE));

const secret: Secret = {
	ref: 'op://vault/item/field',
	resolve: resolveSecret,
};

const plan = (root: string): Plan => ({
	steps: [
		{
			title: 'first',
			cwd: root,
			argv: ['echo', 'one', secret],
			env: { TOKEN: secret, PLAIN: 'visible' },
		},
		{
			title: 'second',
			cwd: 'src',
			argv: ['echo', 'two words', 'line\nbreak\u001b[0m'],
			unless: {
				describe: 'already done',
				check: () => Promise.resolve(true),
			},
		},
	],
	finally: [{ title: 'last', cwd: `${root}/apps`, argv: ['rm', 'x'] }],
});

const action = (log: string[], readOnly?: boolean): Action => ({
	describe: () => ['would act'],
	run: ctx => {
		log.push('ran');
		ctx.stdout.write('acted\n');
		return Promise.resolve(0);
	},
	readOnly,
});

const fixtures = (ran: string[]) =>
	fixtureTree(
		leaf({
			name: 'fx',
			description: 'Fixture.',
			plan: (_value, ctx) => Promise.resolve(plan(ctx.root)),
		}),
		leaf({
			name: 'act',
			description: 'Acts.',
			plan: () => Promise.resolve(action(ran)),
		}),
		leaf({
			name: 'peek',
			description: 'Reads.',
			plan: () => Promise.resolve(action(ran, true)),
		}),
		leaf({
			name: 'fail',
			description: 'Fails.',
			plan: () => Promise.reject(new Failure('busy port')),
		}),
		leaf({
			name: 'boom',
			description: 'Throws.',
			plan: () => Promise.reject(new TypeError('boom')),
		}),
		leaf({
			name: 'ask',
			description: 'Asks twice.',
			plan: async (_value, ctx) => {
				const first = await ctx.prompt('first? ');
				const second = await ctx.prompt('second? ');
				ctx.stdout.write(`${first}+${second}\n`);
				return { steps: [] };
			},
		}),
	);

const groupLine = (group: string) =>
	new RegExp(`^\\s*${group}\\s`, 'm');

/** A session over the fixture's that counts the contexts it builds. */
const counting = () => {
	let built = 0;
	return {
		built: () => built,
		session: (): Session<Context> => ({
			context: base => {
				built++;
				return { ...base, root: tmpdir() };
			},
		}),
	};
};

describe('the program run', () => {
	test('-h is --help, at the root and under a group', async () => {
		const short = await run(['-h']);
		expect(short.code).toBe(0);
		expect(short.stdout).toBe((await run(['--help'])).stdout);
		expect(short.stdout).toContain('-h, --help');
		for (const group of ['infra', 'dev', 'doctor', 'i', 'completion'])
			expect(short.stdout).toMatch(groupLine(group));
		const dev = await run(['dev', '-h']);
		expect(dev.code).toBe(0);
		expect(dev.stdout).toBe((await run(['dev', '--help'])).stdout);
	});

	test('refuses an unknown command under the root usage', async () => {
		const { code, stderr, stdout } = await run(['nope']);
		expect(code).toBe(2);
		expect(stderr).toMatch(/^Usage: fx /);
		expect(stderr).toContain('fx doctor ');
		expect(stderr).toMatch(/\nError: .*nope.*\n$/);
		expect(stdout).toBe('');
	});

	test("a mistake inside a command gets that command's usage", async () => {
		const usageOf = (text: string) => text.split('\n\n')[0];

		const cases: readonly [string[], string[], RegExp][] = [
			[['dev', 'start', '--nope'], ['dev', 'start'], /nope/],
			[['dev', 'nope'], ['dev'], /nope/],
			[['infra', 'up'], ['infra', 'up'], /Missing option/],
		];
		for (const [argv, opened, error] of cases) {
			const { code, stderr, stdout } = await run(argv);
			const help = await run(['help', ...opened]);
			const errorLine = stderr.split('\n').at(-2);
			expect(code).toBe(2);
			expect(stdout).toBe('');
			expect(errorLine).toMatch(error);
			expect(stderr).toBe(`${usageOf(help.stdout)}\n${errorLine}\n`);
		}
	});

	test('a bare group prints its own help, and globals alone the root usage', async () => {
		for (const argv of [['dev'], ['-q', 'dev']]) {
			const { code, stdout, stderr } = await run(argv);
			expect(code).toBe(2);
			expect(stdout).toBe('');
			expect(stderr).toBe((await run(['help', 'dev'])).stdout);
			expect(stderr).toMatch(groupLine('start'));
		}
		for (const argv of [[], ['-q']]) {
			const { code, stderr } = await run(argv);
			expect(code).toBe(2);
			expect(stderr).toContain('Usage');
			expect(stderr).not.toContain('Error');
		}
	});

	test('completes from the parser, the builder over the groups alone', async () => {
		const { code, stdout } = await run(['completion', 'zsh']);
		expect(code).toBe(0);
		expect(stdout).toContain('compdef');
		const leaves = await run(['completion', 'zsh', 'dev', '']);
		expect(leaves.stdout).toMatch(/^start\b/m);
		const groups = await run(['completion', 'zsh', 'i', '']);
		expect(groups.stdout).toMatch(/^dev\b/m);
		expect(groups.stdout).toMatch(/^infra\b/m);
		expect(groups.stdout).not.toMatch(/^doctor\b/m);
	});

	test('loads a lazy group only for an argv that opens on it', async () => {
		const loads = (text: string) =>
			text.split('loading infra').length - 1;

		expect(loads((await run(['-vv', 'dev', '--help'])).stderr)).toBe(0);
		const help = await run(['-vv', 'infra', '--help']);
		expect(loads(help.stderr)).toBe(1);
		expect(help.stdout).toContain('up -e/--env ENV');
		expect(
			loads((await run(['-vv', '--dry-run', 'infra', 'down'])).stderr),
		).toBe(1);
		expect(
			loads(
				(await run(['completion', 'zsh', '-vv', 'infra', 'up', '']))
					.stderr,
			),
		).toBe(1);
	});

	test('builds the context only for a leaf about to plan', async () => {
		const count = counting();
		for (const argv of [['--help'], ['completion', 'zsh'], ['dev']])
			await run(argv, { session: count.session });
		expect(count.built()).toBe(0);
		expect(
			(
				await run(['--dry-run', 'dev', 'stop'], {
					session: count.session,
				})
			).code,
		).toBe(0);
		expect(count.built()).toBe(1);
	});

	test('opens a screen for its group alone on a terminal', async () => {
		const tty = () => terminal();

		const opened = await run(['dev'], { stdin: tty() });
		expect(opened.code).toBe(0);
		expect(opened.stdout).toBe('the dev screen\n');
		const listed = await run(['--dry-run', 'dev'], { stdin: tty() });
		expect(listed.code).toBe(2);
		expect(listed.stdout).toBe('');
	});

	test('refuses a builder path naming no group, or no terminal', async () => {
		const named = await run(['i', 'nope']);
		expect(named.code).toBe(2);
		expect(named.stderr).toContain('nope');
		const offTerminal = await run(['i']);
		expect(offTerminal.code).toBe(2);
		expect(offTerminal.stderr).toContain('needs a terminal');
	});

	test('prints the plan under dry-run', async () => {
		const program = fixtures([]);
		resolveSecret.mockClear();
		const { code, stdout, stderr } = await run(
			['-vv', '--dry-run', 'fx'],
			{ program },
		);
		expect(code).toBe(0);
		expect(
			stdout.split('\n').filter(line => line.startsWith('$ ')),
		).toEqual([
			'$ echo one <op://vault/item/field>',
			"$ echo 'two words' $'line\\nbreak\\e[0m'",
			'$ rm x',
		]);
		expect(stdout).toContain(
			'  env: TOKEN ← op://vault/item/field, PLAIN',
		);
		expect(stdout.match(/^  cwd: (.*)$/gm)).toEqual([
			'  cwd: .',
			'  cwd: src',
			'  cwd: apps',
		]);
		expect(stdout).toContain('  only if not: already done');
		expect(stdout).toMatch(/\nfinally:\n# last\n/);
		expect(resolveSecret).not.toHaveBeenCalled();
		for (const text of [stdout, stderr]) {
			expect(text).not.toContain(SECRET_VALUE);
			expect(text).not.toContain('visible');
		}
	});

	test('describes an action under dry-run', async () => {
		const ran: string[] = [];
		const program = fixtures(ran);
		const described = await run(['--dry-run', 'act'], { program });
		expect(described.code).toBe(0);
		expect(described.stdout).toBe('would act\n');
		expect(ran).toEqual([]);
		const peeked = await run(['--dry-run', 'peek'], { program });
		expect(peeked.code).toBe(0);
		expect(peeked.stdout).toBe('acted\n');
		expect(ran).toEqual(['ran']);
		const acted = await run(['act'], { program });
		expect(acted.code).toBe(0);
		expect(acted.stdout).toBe('acted\n');
		expect(ran).toEqual(['ran', 'ran']);
	});

	test('maps a failure to 1 and an unknown error to 1 with its stack at debug', async () => {
		const program = fixtures([]);
		const failed = await run(['fail'], { program });
		expect(failed.code).toBe(1);
		expect(failed.stderr).toBe('error: busy port\n');
		const thrown = await run(['boom'], { program });
		expect(thrown.code).toBe(1);
		expect(thrown.stderr).toBe('error: boom\n');
		const traced = await run(['-v', 'boom'], { program });
		expect(traced.code).toBe(1);
		expect(traced.stderr).toMatch(
			/error: boom\ndebug: TypeError: boom\n\s+at /,
		);
	});

	test('prompts through stdin and refuses when it ends', async () => {
		const program = fixtures([]);
		const answered = await run(['--dry-run', 'ask'], {
			program,
			stdin: stdin({ tty: false, lines: ['staging', 'second'] }),
		});
		expect(answered.code).toBe(0);
		expect(answered.stdout).toBe('staging+second\n');
		expect(answered.stderr).toBe('first? second? ');
		const ended = await run(['--dry-run', 'ask'], {
			program,
			stdin: stdin({ tty: false, lines: ['only'] }),
		});
		expect(ended.code).toBe(2);
		expect(ended.stderr).toBe(
			'first? second? error: no answer to "second? ": input ended\n',
		);
	});
});
