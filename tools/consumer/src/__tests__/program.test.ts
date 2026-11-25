import { expect, test } from 'bun:test';

import { runCaptured } from '@four7/cli-core/testing';

import { nt } from '../program.ts';

test('a dry run prints the plan', async () => {
	const run = await runCaptured(
		nt.run,
		['--dry-run', 'notes', 'add', 'hi'],
		{},
	);
	expect(run.code).toBe(0);
	expect(run.stdout).toContain('Append the note');
});
