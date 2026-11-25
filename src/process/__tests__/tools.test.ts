import { beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { Refusal } from '../../core/errors.ts';
import { stubTools } from '../../testing/index.ts';
import { findTool, preflight } from '../tools.ts';

// The stubs stand alone on PATH, so the machine's tools are out of
// reach and a refusal names them.
const stubs = stubTools({ present: '' });

const refusalOf = (names: readonly string[]): Refusal => {
	try {
		preflight(names);
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error('preflight did not refuse');
};

beforeEach(() => {
	stubs.only();
});

describe('findTool', () => {
	test('answers the path PATH gives a program, and undefined for none', () => {
		expect(findTool('present')).toBe(join(stubs.dir, 'present'));
		expect(findTool('absent')).toBeUndefined();
	});

	test('reads PATH as it is now, not as the process started with it', () => {
		process.env.PATH = '/nonexistent';
		expect(findTool('present')).toBeUndefined();
	});
});

describe('preflight', () => {
	test('passes when every program is on PATH, or none is asked for', () => {
		expect(() => preflight(['present'])).not.toThrow();
		expect(() => preflight([])).not.toThrow();
	});

	test('refuses, naming every missing program and no present one', () => {
		expect(refusalOf(['present', 'absent', 'gone']).message).toBe(
			'missing from PATH: absent, gone',
		);
	});
});
