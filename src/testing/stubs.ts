import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The variable a stub's script reads its directory from. */
export const STUB_DIR = 'STUB_DIR';

const ALL_CALLS = 'all';

/** The stubs a suite puts first on PATH, one script per tool. */
export interface Stubs {
	/** The directory holding them, from `beforeAll` on. */
	readonly dir: string;
	/** Writes a stub's body for the current test, over the suite's. */
	stub(name: string, body: string): void;
	/**
	 * The arguments each call of `name` got, one line per call; without
	 * a name, every stub's calls in order, each line `name args`.
	 */
	calls(name?: string): string[];
	/**
	 * Puts the stubs alone on PATH, so the machine's tools are out of
	 * reach.
	 */
	only(): void;
}

/**
 * Stubs for the suite, written once and overwritten in place per
 * test, since macOS pays a first-exec cost per new executable: each
 * body runs under sh after its call is logged, with `$STUB_DIR` naming
 * the directory. PATH gets the directory first for every test and is
 * restored after; a stub a test adds is gone before the next.
 */
export function stubTools(
	suite: Readonly<Record<string, string>>,
): Stubs {
	let dir = '';
	let path = '';

	const file = (name: string) => join(dir, name);

	const logOf = (name: string) => join(dir, `${name}.log`);

	const write = (name: string, body: string) => {
		const fresh = !existsSync(file(name));
		writeFileSync(
			file(name),
			`#!/bin/sh\nprintf '%s\\n' "$*" >> "$${STUB_DIR}/${name}.log"\nprintf '%s %s\\n' ${JSON.stringify(name)} "$*" >> "$${STUB_DIR}/${ALL_CALLS}.log"\n${body}\n`,
		);
		if (fresh) chmodSync(file(name), 0o755);
	};

	const names = () => Object.keys(suite);

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), 'cli-stubs-'));
		for (const [name, body] of Object.entries(suite)) write(name, body);
	});

	beforeEach(() => {
		path = process.env.PATH ?? '';
		process.env.PATH = `${dir}:${path}`;
		process.env[STUB_DIR] = dir;
		for (const [name, body] of Object.entries(suite)) write(name, body);
		for (const entry of readdirSync(dir))
			if (entry.endsWith('.log') || !names().includes(entry))
				rmSync(file(entry), { force: true, recursive: true });
	});

	afterEach(() => {
		process.env.PATH = path;
		delete process.env[STUB_DIR];
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	return {
		get dir() {
			return dir;
		},
		stub: write,
		calls: (name = ALL_CALLS) =>
			existsSync(logOf(name))
				? readFileSync(logOf(name), 'utf8').split('\n').filter(Boolean)
				: [],
		only() {
			process.env.PATH = dir;
		},
	};
}
