import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { object } from '@optique/core/constructs';
import { option } from '@optique/core/primitives';
import { string } from '@optique/core/valueparser';

import { fixtureTree, runCaptured } from '../../testing/index.ts';
import { builders } from '../builders.ts';
import type { Context } from '../command.ts';
import type { Environment } from '../config.ts';
import { config, fixture } from './fixture.ts';

interface Seen {
	readonly greeting: string;
}

let dir = '';

let seen: Seen | undefined;

const { leaf } = builders<Context>();

const program = fixtureTree(
	leaf({
		name: 'fx',
		description: 'Fixture.',
		args: object({
			greeting: config.configured(
				option('--greeting', string()),
				c => c.greeting,
			),
		}),
		plan: value => {
			seen = { greeting: value.greeting };
			return Promise.resolve({ steps: [] });
		},
	}),
);

/** A run under `env` alone, its home in the scratch directory. */
const fx = (argv: string[], env: Environment = {}) => {
	seen = undefined;
	return runCaptured(fixture.run, argv, {
		program,
		load: path =>
			config.load(path, { HOME: join(dir, 'none'), ...env }),
	});
};

const configAt = (base: string, toml: string): string => {
	const file = join(base, 'fixture', 'config.toml');
	mkdirSync(join(base, 'fixture'), { recursive: true });
	writeFileSync(file, toml);
	return file;
};

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cli-config-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('config precedence', () => {
	test('flag, then variable, then file, then the schema', async () => {
		const xdg = join(dir, 'xdg');
		configAt(xdg, 'greeting = "from the file"\n');
		const env = {
			XDG_CONFIG_HOME: xdg,
			FIXTURE_GREETING: 'from the variable',
		};
		expect((await fx(['fx', '--greeting', 'flagged'], env)).code).toBe(
			0,
		);
		expect(seen?.greeting).toBe('flagged');
		expect((await fx(['fx'], env)).code).toBe(0);
		expect(seen?.greeting).toBe('from the variable');
		expect((await fx(['fx'], { XDG_CONFIG_HOME: xdg })).code).toBe(0);
		expect(seen?.greeting).toBe('from the file');
		expect((await fx(['fx'])).code).toBe(0);
		expect(seen?.greeting).toBe('hello');
		expect(config.defaults).toEqual({ greeting: 'hello' });
		expect(config.defaults.port).toBeUndefined();
	});

	test("help shows the schema's default", async () => {
		const { stdout } = await fx(['fx', '--help']);
		expect(stdout).toMatch(/--greeting.*\bhello\b/);
	});

	test('a variable names itself as the source of a key', () => {
		expect(config.sourceOf('GREETING')).toEqual({
			key: 'greeting',
			variable: 'FIXTURE_GREETING',
		});
	});
});

describe('config location', () => {
	test('XDG_CONFIG_HOME, else ~/.config, else the defaults', async () => {
		const xdg = join(dir, 'xdg');
		const home = join(dir, 'home');
		configAt(xdg, 'greeting = "xdg"\n');
		configAt(join(home, '.config'), 'greeting = "home"\n');
		await fx(['fx'], { XDG_CONFIG_HOME: xdg, HOME: home });
		expect(seen?.greeting).toBe('xdg');
		await fx(['fx'], { HOME: home });
		expect(seen?.greeting).toBe('home');
		await fx(['fx'], { XDG_CONFIG_HOME: 'relative/xdg', HOME: home });
		expect(seen?.greeting).toBe('home');
		rmSync(join(home, '.config'), { recursive: true });
		await fx(['fx'], { HOME: home });
		expect(seen?.greeting).toBe('hello');
	});

	test('--config names the file over the default locations', async () => {
		const home = join(dir, 'home');
		configAt(join(home, '.config'), 'greeting = "home"\n');
		const file = join(dir, 'own.toml');
		writeFileSync(file, 'greeting = "own"\n');
		expect(
			(await fx(['--config', file, 'fx'], { HOME: home })).code,
		).toBe(0);
		expect(seen?.greeting).toBe('own');
		const missing = await fx([
			'--config',
			join(dir, 'none.toml'),
			'fx',
		]);
		expect(missing.code).toBe(2);
		expect(missing.stderr).toContain('none.toml');
		expect(seen).toBeUndefined();
	});
});

describe('refuses a bad config', () => {
	test('names the file and each failing key, without a stack', async () => {
		const file = join(dir, 'bad.toml');
		writeFileSync(file, 'greeting = 3\n[nope]\nx = 1\n');
		const { code, stdout, stderr } = await fx([
			'-v',
			'--config',
			file,
			'fx',
		]);
		expect(code).toBe(2);
		expect(stdout).toBe('');
		expect(stderr).toContain(`invalid config in ${file}`);
		expect(stderr).toMatch(/^ {2}greeting: /m);
		expect(stderr).toContain('nope');
		expect(stderr).not.toMatch(/^\s+at /m);
		expect(seen).toBeUndefined();
	});

	test('a bad variable is refused by its name', () => {
		expect(() =>
			config.load(undefined, { HOME: dir, FIXTURE_PORT: 'next' }),
		).toThrow(/port \(FIXTURE_PORT\)/);
		expect(
			config.load(undefined, { HOME: dir, FIXTURE_PORT: '4700' }).value
				.port,
		).toBe(4700);
	});

	test('help reads no config', async () => {
		const file = join(dir, 'bad.toml');
		writeFileSync(file, 'greeting = 3\n');
		const { code, stdout } = await fx([
			'--config',
			file,
			'fx',
			'--help',
		]);
		expect(code).toBe(0);
		expect(stdout).toContain('--greeting');
	});

	test('names the file on a syntax error', async () => {
		const file = join(dir, 'broken.toml');
		writeFileSync(file, 'greeting = [\n');
		const { code, stderr } = await fx(['-v', '--config', file, 'fx']);
		expect(code).toBe(2);
		expect(stderr).toContain(`error: ${file}:`);
		expect(stderr).not.toMatch(/^\s+at /m);
	});

	test('names a path it cannot read', async () => {
		const directory = await fx(['-v', '--config', dir, 'fx']);
		expect(directory.code).toBe(2);
		expect(directory.stderr).toContain(`cannot read config ${dir}`);
		expect(directory.stderr).not.toMatch(/^\s+at /m);
		const home = join(dir, 'home');
		const file = configAt(join(home, '.config'), '');
		chmodSync(file, 0o000);
		const unreadable = await fx(['-v', 'fx'], { HOME: home });
		expect(unreadable.code).toBe(2);
		expect(unreadable.stderr).toContain(`cannot read config ${file}`);
	});
});
