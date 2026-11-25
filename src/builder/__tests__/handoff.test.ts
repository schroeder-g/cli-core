import { describe, expect, test } from 'bun:test';

import { object } from '@optique/core/constructs';
import { multiple, optional } from '@optique/core/modifiers';
import { argument, flag, option } from '@optique/core/primitives';
import { choice, string } from '@optique/core/valueparser';

import { run as runFixture } from '../../core/__tests__/fixture.ts';
import { builders } from '../../core/builders.ts';
import type { Context } from '../../core/command.ts';
import type { InputStream } from '../../core/streams.ts';
import {
	capture,
	drive as driveScreen,
	fixtureTree,
	open,
	shown,
	stdin,
	terminal,
} from '../../testing/index.ts';
import type { Step } from '../../testing/index.ts';
import { form, toArgv } from '../fields.ts';
import { openBuilder } from '../index.ts';

const ENTER = '\r';

const DOWN = '\u001b[B';

const ESCAPE = '\u001b';

const POLL_MS = 15;

const { leaf } = builders<Context>();

const program = fixtureTree(
	leaf({
		name: 'fx',
		description: 'Fixture.',
		args: object({
			mode: option(
				'--mode',
				choice(['fast', 'slow'], { metavar: 'MODE' }),
			),
			tag: multiple(option('--tag', string({ metavar: 'TAG' }))),
			force: optional(flag('--force')),
			rest: multiple(argument(string({ metavar: 'REST' }))),
		}),
		plan: (value, ctx) =>
			Promise.resolve({
				steps: [
					{
						title: 'fx',
						cwd: ctx.root,
						argv: [
							'echo',
							value.mode,
							...value.tag,
							String(value.force ?? false),
							...value.rest,
						],
					},
				],
			}),
	}),
);

const run = (argv: string[]) => runFixture(argv, { program });

const built = async (values: Record<string, string>) => {
	const fields = await form(program, ['fx']);
	const filled = fields.map(field => ({
		field,
		value: values[field.metavar ?? field.names[0] ?? ''] ?? '',
	}));
	return toArgv(['fx'], filled);
};

const io = (input: InputStream) => ({
	stdin: input,
	stdout: capture(),
	stderr: capture(),
});

const at = shown;

/**
 * Drives the builder on a fake terminal: each key goes in once its
 * marker has been drawn, since a key sent while a level or a form is
 * still loading reaches no input. The builder draws on stderr.
 */
const drive = async (steps: readonly Step[], path: string[] = []) => {
	const stdout = capture();
	const { result, screen } = await driveScreen(
		open((stdin, stderr) =>
			openBuilder('fx', program, path, { stdin, stdout, stderr }),
		),
		steps,
	);
	return { argv: result, stdout: stdout.text(), stderr: screen };
};

describe('builder hands its argv to the parser', () => {
	test('a value outside a choice fails with the flag path message', async () => {
		const argv = await built({ MODE: 'nope', REST: 'x' });
		expect(argv).toEqual(['fx', '--mode', 'nope', '--', 'x']);
		const fromBuilder = await run(argv);
		const typed = await run(['fx', '--mode', 'nope', 'x']);
		expect(fromBuilder.code).toBe(2);
		expect(fromBuilder.stderr).toContain('nope');
		expect(fromBuilder.stderr).toBe(typed.stderr);
		expect(fromBuilder.stdout).toBe('');
	});

	test('a valid argv prints the same dry-run plan as typed', async () => {
		const argv = await built({
			MODE: 'fast',
			TAG: 'a b',
			'--force': 'yes',
			REST: 'p "q r"',
			'--dry-run': 'yes',
		});
		const fromBuilder = await run(argv);
		const typed = await run([
			'--dry-run',
			'fx',
			'--mode',
			'fast',
			'--tag',
			'a',
			'--tag',
			'b',
			'--force',
			'--',
			'p',
			'q r',
		]);
		expect(fromBuilder.code).toBe(0);
		expect(fromBuilder.stdout).toContain(
			"$ echo fast a b true p 'q r'",
		);
		expect(fromBuilder.stdout).toBe(typed.stdout);
		expect(fromBuilder.stderr).toBe('');
	});

	test('the app unmounts and hands back what was filled in', async () => {
		const { argv, stdout, stderr } = await drive([
			at('Fixture.', ENTER),
			at('--mode MODE', ENTER),
			at('--tag TAG', 'a b'),
			at('  a b', ENTER),
			at('--force', ENTER),
			at('REST', ENTER),
			at('--dry-run', DOWN),
			at('--dry-run', ENTER),
			at('--config FILE', ENTER),
			at('-q, --quiet', ENTER),
			at('-v, --verbose', ENTER),
			at('Run it?', 'y'),
		]);
		expect(argv).toEqual([
			'fx',
			'--mode',
			'fast',
			'--tag',
			'a',
			'--tag',
			'b',
			'--dry-run',
		]);
		expect(stdout).toBe('');
		expect(stderr).toContain(
			'fx fx --mode fast --tag a --tag b --dry-run',
		);
		expect(stderr).toContain('y/N');
	});

	test('Escape cancels and Enter at the confirmation does not run', async () => {
		expect(
			(await drive([at('Fixture.', ENTER), at('--mode MODE', ESCAPE)]))
				.argv,
		).toBeUndefined();
		const declined = await drive([
			at('Fixture.', ENTER),
			at('--mode MODE', ENTER),
			at('--tag TAG', ENTER),
			at('--force', ENTER),
			at('REST', ENTER),
			at('--dry-run', ENTER),
			at('--config FILE', ENTER),
			at('-q, --quiet', ENTER),
			at('-v, --verbose', ENTER),
			at('Run it?', ENTER),
		]);
		expect(declined.stderr).toContain('fx fx --mode fast');
		expect(declined.argv).toBeUndefined();
	});
});

describe('builder gates', () => {
	test('refuses a stdin that is not a terminal', async () => {
		await expect(
			openBuilder('fx', program, [], io(stdin({ tty: false }))),
		).rejects.toThrow(/needs a terminal/);
	});

	test('refuses a terminal that cannot enter raw mode', async () => {
		await expect(
			openBuilder('fx', program, [], io(stdin({ tty: true }))),
		).rejects.toThrow(/needs a terminal/);
	});

	test('refuses a path naming no group, before the terminal is judged', async () => {
		await expect(
			openBuilder('fx', program, ['nope'], io(stdin({ tty: false }))),
		).rejects.toThrow(/`nope` names no command group/);
		await expect(
			openBuilder('fx', program, ['fx'], io(terminal())),
		).rejects.toThrow(/`fx` is a command, not a group/);
	});

	test('cancels when the input ends', async () => {
		const input = terminal();
		const opened = openBuilder('fx', program, [], io(input));
		await Bun.sleep(POLL_MS);
		input.end();
		expect(await opened).toBeUndefined();
	});
});
