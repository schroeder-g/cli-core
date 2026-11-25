import { describe, expect, test } from 'bun:test';
import { formatUsage } from '@optique/core/usage';
import type { Usage } from '@optique/core/usage';

import { synopsis, synopsisOver } from '../synopsis.ts';

const dryRun: Usage[number] = {
	type: 'optional',
	terms: [{ type: 'option', names: ['--dry-run'] }],
};

const commands: Usage[number] = {
	type: 'exclusive',
	terms: [
		[
			{ type: 'command', name: 'start' },
			{ type: 'option', names: ['--fresh'] },
		],
		[{ type: 'command', name: 'stop' }],
	],
};

describe('the synopsis', () => {
	test('folds the commands into COMMAND [ARG...] after the flags', () => {
		expect(formatUsage('fx', synopsis([commands, dryRun]))).toBe(
			'fx [--dry-run] COMMAND [ARG...]',
		);
		expect(formatUsage('fx', synopsisOver([dryRun]))).toBe(
			'fx [--dry-run] COMMAND [ARG...]',
		);
	});

	test('leaves a usage naming no commands as it is', () => {
		const leaf: Usage = [
			dryRun,
			{ type: 'option', names: ['--fresh'] },
		];
		expect(synopsis(leaf)).toBe(leaf);
	});
});
