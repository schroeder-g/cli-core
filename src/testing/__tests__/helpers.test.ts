import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { defineConfig, verbatim } from '../../core/config.ts';
import type { Environment } from '../../core/config.ts';
import { Failure, Refusal } from '../../core/errors.ts';
import { hermetic, refused, writeUnder } from '../index.ts';

const config = defineConfig({
	name: 'helpers-fixture',
	envPrefix: 'HELPERS_FIXTURE_',
	schema: z
		.strictObject({ greeting: z.string().default('hello') })
		.prefault({}),
	variables: { GREETING: { path: ['greeting'], read: verbatim } },
});

let dir = '';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cli-core-helpers-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const rejection = async (
	pending: Promise<unknown>,
): Promise<string> => {
	try {
		await pending;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error('refused() passed');
};

describe('refused', () => {
	test('passes a Refusal holding each text, and answers it', async () => {
		const refusal = await refused(
			Promise.reject(new Refusal('nope is no app; the apps are api')),
			'nope is no app',
			'the apps are api',
		);
		expect(refusal).toBeInstanceOf(Refusal);
	});

	test('fails a run that resolves', async () => {
		expect(await rejection(refused(Promise.resolve(0)))).toBe(
			'expected a Refusal, but the run resolved',
		);
	});

	test('fails another error, naming it', async () => {
		expect(
			await rejection(refused(Promise.reject(new Failure('busy')))),
		).toBe('expected a Refusal, but the run threw Failure: busy');
	});

	test('fails a Refusal missing a text, naming the text and the message', async () => {
		expect(
			await rejection(
				refused(Promise.reject(new Refusal('nope is no app')), 'bogus'),
			),
		).toBe('the Refusal does not hold "bogus": nope is no app');
	});
});

describe('writeUnder', () => {
	test('writes the file, its directories made', () => {
		writeUnder(dir, 'notes/2026/one.txt', 'KEY=\n');
		writeUnder(dir, 'notes/2026/two.txt', 'OTHER=\n');
		expect(readFileSync(join(dir, 'notes/2026/one.txt'), 'utf8')).toBe(
			'KEY=\n',
		);
		expect(readFileSync(join(dir, 'notes/2026/two.txt'), 'utf8')).toBe(
			'OTHER=\n',
		);
	});
});

describe('hermetic', () => {
	const VARIABLE = 'HELPERS_FIXTURE_GREETING';

	const saved = {
		home: process.env.HOME,
		variable: process.env[VARIABLE],
	};

	const restore = (key: string, value: string | undefined): void => {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	};

	const greeting = (path?: string, env?: Environment): string =>
		hermetic(config, env)(path).value.greeting;

	let home = '';

	// The process's own home holds a file and its environment a
	// variable, either of which a leaky load would read.
	beforeEach(() => {
		home = join(dir, 'home');
		writeUnder(
			home,
			'.config/helpers-fixture/config.toml',
			'greeting = "from home"\n',
		);
		process.env.HOME = home;
		process.env[VARIABLE] = 'from the process';
	});

	afterEach(() => {
		restore('HOME', saved.home);
		restore(VARIABLE, saved.variable);
	});

	test('reads no home file and no process variable, only `env`', () => {
		expect(greeting()).toBe('hello');
		expect(greeting(undefined, { [VARIABLE]: 'from env' })).toBe(
			'from env',
		);
		expect(greeting(undefined, { HOME: home })).toBe('from home');
	});

	test('reads the file --config names', () => {
		writeUnder(dir, 'named.toml', 'greeting = "named"\n');
		expect(greeting(join(dir, 'named.toml'))).toBe('named');
	});
});
