import { describe, expect, test } from 'bun:test';

import { spawnChild } from '../spawn.ts';

describe('spawnChild', () => {
	test('kill on a detached child whose group has gone does nothing, as on one that is not detached', async () => {
		for (const detached of [false, true]) {
			const child = await spawnChild(
				{ title: 'quits', cwd: '.', argv: ['true'] },
				{ detached, output: { prefix: 'quits' } },
			);
			expect(await child.exited).toBe(0);
			expect(() => child.kill('SIGTERM')).not.toThrow();
		}
	});
});
