import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROGRAM = join(import.meta.dir, '..', 'nt.ts');

let home: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), 'nt-'));
});

/** The README's program run as its shebang runs it, in `home`. */
const nt = (
	argv: readonly string[],
	env: Record<string, string> = {},
) => {
	const run = Bun.spawnSync(
		['bun', '--env-file=/dev/null', PROGRAM, ...argv],
		{
			cwd: home,
			env: { PATH: process.env.PATH, XDG_CONFIG_HOME: home, ...env },
		},
	);
	return { code: run.exitCode, stdout: run.stdout.toString() };
};

describe("the README's program", () => {
	test('--help lists its group', () => {
		const help = nt(['--help']);
		expect(help.code).toBe(0);
		expect(help.stdout).toMatch(/notes\s+Keep notes\./);
	});

	test('adds a note and lists it', () => {
		expect(nt(['notes', 'add', 'buy milk']).code).toBe(0);
		expect(nt(['notes', 'list'])).toEqual({
			code: 0,
			stdout: 'buy milk\n',
		});
	});

	test('a dry run prints the step and adds nothing', () => {
		const planned = nt(['--dry-run', 'notes', 'add', 'buy milk']);
		expect(planned.code).toBe(0);
		expect(planned.stdout).toContain('# Append the note');
		expect(existsSync(join(home, 'notes.txt'))).toBe(false);
	});

	test('NT_FILE names the file', () => {
		const other = join(home, 'other.txt');
		writeFileSync(other, 'from elsewhere\n');
		expect(nt(['notes', 'list'], { NT_FILE: other }).stdout).toBe(
			'from elsewhere\n',
		);
	});
});
