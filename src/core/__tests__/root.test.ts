import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runCaptured } from '../../testing/index.ts';
import type { Context } from '../command.ts';
import { Refusal } from '../errors.ts';
import { commands } from '../program.ts';
import type { ProgramSpec, RunProgramOptions } from '../program.ts';
import { config } from './fixture.ts';
import type { FixtureConfig } from './fixture.ts';

const NO_HOME = join(tmpdir(), 'cli-root-no-home');

const { leaf, group, program } = commands(config).over();

type RootConfig = FixtureConfig;

const load = (path: string | undefined) =>
	config.load(path, { HOME: NO_HOME });

const where = leaf({
	name: 'where',
	description: 'Print the root.',
	plan: () =>
		Promise.resolve({
			readOnly: true,
			describe: () => [],
			run: (ctx: Context) => {
				ctx.stdout.write(`${ctx.root}\n`);
				return Promise.resolve(0);
			},
		}),
});

const twice = leaf({
	name: 'twice',
	description: 'Plan two steps.',
	plan: () =>
		Promise.resolve({
			steps: [
				{ title: 'one', cwd: '.', argv: ['true'] },
				{ title: 'two', cwd: '.', argv: ['true'] },
			],
		}),
});

const rooted = (root?: ProgramSpec<Context, RootConfig>['root']) =>
	program({
		name: 'rt',
		commands: [
			group({
				name: 'at',
				description: 'Where it runs.',
				commands: [where, twice],
			}),
		],
		root,
		session: () => ({ context: base => base }),
	});

const run = (
	located: string[],
	argv: readonly string[],
	opts: RunProgramOptions<Context, RootConfig> = {},
) =>
	runCaptured(
		rooted(cwd => {
			located.push(cwd);
			if (cwd === '/outside')
				throw new Refusal(`no root encloses ${cwd}`);
			return `${cwd}/root`;
		}).run,
		argv,
		{ load, ...opts },
	);

describe("the program's root", () => {
	test('is located from the run’s cwd, once, for a leaf about to plan', async () => {
		const located: string[] = [];
		const printed = await run(located, ['at', 'where'], { cwd: '/x' });
		expect(printed).toMatchObject({ code: 0, stdout: '/x/root\n' });
		expect(located).toEqual(['/x']);
		const planned = await run(located, ['--dry-run', 'at', 'twice'], {
			cwd: '/y',
		});
		expect(planned.code).toBe(0);
		expect(located).toEqual(['/x', '/y']);
	});

	test('is never located for help, completion or a bare group', async () => {
		const located: string[] = [];
		for (const argv of [
			['--help'],
			['at', '--help'],
			['completion', 'zsh'],
			['at'],
		])
			await run(located, argv, { cwd: '/outside' });
		expect(located).toEqual([]);
	});

	test('refuses the run when the locator refuses', async () => {
		const located: string[] = [];
		const refused = await run(located, ['at', 'where'], {
			cwd: '/outside',
		});
		expect(refused.code).toBe(2);
		expect(refused.stderr).toContain('no root encloses /outside');
	});

	test('takes the root a caller located already', async () => {
		const located: string[] = [];
		const given = await run(located, ['at', 'where'], {
			root: '/given',
		});
		expect(given.stdout).toBe('/given\n');
		expect(located).toEqual([]);
	});

	test('is the cwd when the program names no locator', async () => {
		const printed = await runCaptured(rooted().run, ['at', 'where'], {
			load,
			cwd: '/plain',
		});
		expect(printed.stdout).toBe('/plain\n');
	});
});
