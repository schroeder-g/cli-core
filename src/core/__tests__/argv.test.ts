import { describe, expect, test } from 'bun:test';

import {
	configFromArgv,
	levelFromArgv,
	valuedOptions,
} from '../argv.ts';
import { fixture } from './fixture.ts';

const { words, optionTokens, plainWords, wantsHelp } = fixture.reader;

const needsLazy = (argv: readonly string[], tty?: boolean) =>
	fixture.needs(argv, 'infra', tty);

describe('words', () => {
	test("the command words, past every option and a valued one's value", () => {
		const argv = ['-q', 'dev', 'start', '-s', 'nowhere', '--fresh'];
		expect(words(argv)).toEqual(['dev', 'start']);
		expect(plainWords(argv)).toEqual([]);
		expect(plainWords(['-q', 'dev'])).toEqual(['dev']);
	});
});

describe('valuedOptions', () => {
	test('every option that takes a value, under every command', () => {
		const valued = valuedOptions(fixture.build().usage);
		for (const name of ['--config', '-s', '--service', '-e', '--env'])
			expect(valued.has(name)).toBe(true);
		for (const name of ['--fresh', '--dry-run', '-q', '--help'])
			expect(valued.has(name)).toBe(false);
	});
});

describe('needs a lazy group', () => {
	test('an argv opening on it, past the globals and --', () => {
		expect(needsLazy(['infra', 'up', '-e', 'staging'])).toBe(true);
		expect(
			needsLazy(['--dry-run', '--config', 'x', '-vv', 'infra']),
		).toBe(true);
		expect(needsLazy(['--dry-run', '--', 'infra'])).toBe(true);
		expect(needsLazy(['--config', 'infra', 'dev'])).toBe(false);
		expect(needsLazy(['dev', 'start'])).toBe(false);
	});

	test('help on it and the builder', () => {
		expect(needsLazy(['help', 'infra'])).toBe(true);
		expect(needsLazy(['help', 'dev'])).toBe(false);
		expect(needsLazy(['i'])).toBe(true);
		expect(needsLazy(['i', 'dev'])).toBe(true);
	});

	test('a completion request whose words open on it', () => {
		expect(needsLazy(['completion', 'zsh', 'infra', ''])).toBe(true);
		expect(needsLazy(['completion', 'bash', 'dev', 'start', ''])).toBe(
			false,
		);
		expect(needsLazy(['completion', 'zsh'])).toBe(false);
	});

	test("an option's value is never a command word", () => {
		expect(needsLazy(['completion', 'zsh', '-s', 'infra', ''])).toBe(
			false,
		);
		expect(needsLazy(['dev', 'start', '--service', 'infra'])).toBe(
			false,
		);
		expect(needsLazy(['-e', 'infra'])).toBe(false);
	});

	test('globals alone, on a terminal', () => {
		expect(needsLazy([], true)).toBe(true);
		expect(needsLazy(['-vv'], true)).toBe(true);
		expect(needsLazy([])).toBe(false);
	});
});

describe('optionTokens', () => {
	test('keeps every option with the value a valued one takes', () => {
		expect(
			optionTokens([
				'--config',
				'x',
				'dev',
				'start',
				'-s',
				'api,web',
				'--fresh',
				'--dry-run',
			]),
		).toEqual([
			'--config',
			'x',
			'-s',
			'api,web',
			'--fresh',
			'--dry-run',
		]);
	});
});

describe('wantsHelp', () => {
	test('either spelling before --, or the help command', () => {
		expect(wantsHelp(['-h'])).toBe(true);
		expect(wantsHelp(['dev', 'start', '--help'])).toBe(true);
		expect(wantsHelp(['help', 'infra'])).toBe(true);
		expect(
			wantsHelp(['infra', 'up', '-e', 'staging', '--', '-h']),
		).toBe(false);
		expect(wantsHelp(['dev', 'start'])).toBe(false);
	});
});

describe('levelFromArgv', () => {
	test('reads the level flags wherever they stand', () => {
		expect(levelFromArgv([])).toBe('info');
		expect(levelFromArgv(['dev', '-v'])).toBe('debug');
		expect(levelFromArgv(['-vv', 'infra', '--help'])).toBe('trace');
		expect(levelFromArgv(['--verbose', '--verbose', '--verbose'])).toBe(
			'trace',
		);
		expect(levelFromArgv(['-q', '-vv'])).toBe('error');
		expect(levelFromArgv(['--', '-vv'])).toBe('info');
	});
});

describe('configFromArgv', () => {
	test('reads the file --config names, before -- only', () => {
		expect(configFromArgv(['dev'])).toBeUndefined();
		expect(configFromArgv(['--config', 'fx.toml', 'dev'])).toBe(
			'fx.toml',
		);
		expect(
			configFromArgv(['dev', '--', '--config', 'x']),
		).toBeUndefined();
	});
});
