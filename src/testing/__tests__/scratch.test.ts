import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	freshScratch,
	gitSync,
	initRepo,
	ISOLATED_GIT,
	isolateGit,
	scratchDirs,
} from '../index.ts';

const scratch = scratchDirs();

afterEach(() => {
	scratch.clean();
});

describe('scratch directories', () => {
	test('are canonical, and removed together', () => {
		const one = scratch.make('cli-one-');
		const two = scratch.make();
		expect(realpathSync(one)).toBe(one);
		expect(one).toStartWith(realpathSync(tmpdir()));
		scratch.clean();
		expect([existsSync(one), existsSync(two)]).toEqual([false, false]);
	});

	test('refuse a temporary directory inside a checkout', () => {
		const outer = scratch.make();
		initRepo(outer);
		const saved = process.env.TMPDIR;
		process.env.TMPDIR = outer;
		try {
			expect(() => freshScratch()).toThrow(
				`${outer} is a checkout; a scratch directory must not be inside one`,
			);
		} finally {
			process.env.TMPDIR = saved;
		}
	});
});

describe('scratch repositories', () => {
	test('commit what the directory holds on main, under no config of the developer’s', () => {
		const root = scratch.make();
		writeFileSync(join(root, 'README'), 'one\n');
		const head = initRepo(root);
		expect(gitSync(root, 'rev-parse', 'HEAD')).toBe(head);
		expect(gitSync(root, 'branch', '--show-current')).toBe('main');
		expect(gitSync(root, 'ls-files')).toBe('README');
		expect(gitSync(root, 'log', '--format=%an %s')).toBe(
			'cli-core one',
		);
		expect(initRepo(scratch.make(), { branch: 'trunk' })).toMatch(
			/^[0-9a-f]{40}$/,
		);
	});

	test('a failing git throws its stderr', () => {
		expect(() => gitSync(scratch.make(), 'rev-parse', 'HEAD')).toThrow(
			/not a git repository/,
		);
	});

	test('isolateGit sets the isolated config on the process and restores it', () => {
		const saved = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = '/before';
		try {
			const restore = isolateGit();
			for (const [name, value] of Object.entries(ISOLATED_GIT))
				expect(process.env[name]).toBe(value);
			restore();
			expect(process.env.GIT_CONFIG_GLOBAL).toBe('/before');
			expect(process.env.GIT_CONFIG_NOSYSTEM).toBeUndefined();
		} finally {
			if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = saved;
		}
	});
});
