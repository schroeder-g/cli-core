import { describe, expect, test } from 'bun:test';

import { object } from '@optique/core/constructs';

import { fixtureTree } from '../../testing/index.ts';
import { commands } from '../command.ts';
import type { Context } from '../command.ts';
import { Refusal } from '../errors.ts';
import { log } from '../logging.ts';
import { run } from './fixture.ts';

const LEVELS = ['trace', 'debug', 'info', 'warning', 'error'] as const;

const FLAGS: Record<string, string[]> = {
	'-q': ['-q'],
	default: [],
	'-v': ['-v'],
	'-vv': ['-vv'],
};

const { leaf } = commands<Context>();

const program = fixtureTree(
	leaf('speak', 'Logs at every level.', object({}), () => {
		for (const level of LEVELS) log[level](`${level} line`);
		return Promise.resolve({ steps: [] });
	}),
	leaf('refuse', 'Refuses.', object({}), () =>
		Promise.reject(new Refusal('no, thanks')),
	),
	leaf('control', 'Logs a control character.', object({}), () => {
		log.error('path\u001b[31m[0m\u0007');
		return Promise.resolve({ steps: [] });
	}),
);

const spoken = async (flags: string[]) => {
	const { code, stdout, stderr } = await run(
		[...flags, '--dry-run', 'speak'],
		{ program },
	);
	expect(code).toBe(0);
	expect(stdout).toBe('');
	const lines = stderr.split('\n').filter(Boolean);
	expect(
		lines.filter(line => line.toLowerCase().includes('logtape')),
	).toEqual([]);
	return LEVELS.filter(level =>
		lines.includes(`${level}: ${level} line`),
	);
};

describe('verbosity', () => {
	test('-q logs errors only', async () => {
		expect(await spoken(['-q'])).toEqual(['error']);
	});

	test('the default logs from info', async () => {
		expect(await spoken([])).toEqual(['info', 'warning', 'error']);
	});

	test('-v logs from debug', async () => {
		expect(await spoken(['-v'])).toEqual([
			'debug',
			'info',
			'warning',
			'error',
		]);
	});

	test('-vv logs from trace', async () => {
		expect(await spoken(['-vv'])).toEqual([...LEVELS]);
	});

	test('-q beside -v is a usage error', async () => {
		const { code, stderr } = await run(['-q', '-vv', 'speak'], {
			program,
		});
		expect(code).toBe(2);
		expect(stderr).toContain('-vv');
	});

	test('a refusal reaches stderr at every level', async () => {
		for (const flags of Object.values(FLAGS)) {
			const { code, stdout, stderr } = await run([...flags, 'refuse'], {
				program,
			});
			expect(code).toBe(2);
			expect(stdout).toBe('');
			expect(
				stderr.split('\n').filter(line => line.startsWith('error:')),
			).toEqual(['error: no, thanks']);
		}
	});

	test('control characters print as text', async () => {
		const { stderr } = await run(['--dry-run', 'control'], { program });
		expect(stderr).toContain('error: path\\x1b[31m[0m\\x07');
		const codes = stderr.split('').map(char => char.charCodeAt(0));
		expect(codes.filter(code => code < 0x20 && code !== 0x0a)).toEqual(
			[],
		);
	});
});
