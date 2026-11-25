import { afterEach, describe, expect, test } from 'bun:test';

import { freePort } from '../../testing/ports.ts';
import { awaitListening, listenWithRetry } from '../listening.ts';
import { groupAlive } from '../signals.ts';
import { spawnChild } from '../spawn.ts';
import type { ChildHandle } from '../spawn.ts';
import { listener, SETTLE_MS } from './trees.ts';

const RETRY_MS = 50;

const started: ChildHandle[] = [];

const spawned = async (code: string): Promise<ChildHandle> => {
	const child = await spawnChild(
		{ title: 'child', cwd: '.', argv: ['bun', '-e', code] },
		{ detached: true, output: { prefix: 'child' } },
	);
	started.push(child);
	return child;
};

afterEach(() => {
	for (const child of started.splice(0))
		if (groupAlive(child.pid)) child.kill('SIGKILL');
});

describe('awaitListening', () => {
	test('answers listening once the port connects', async () => {
		const port = await freePort();
		const child = await spawned(listener(port));
		expect(await awaitListening(child, port, SETTLE_MS)).toEqual({
			kind: 'listening',
		});
	});

	test('answers the code of a child that exits first', async () => {
		const port = await freePort();
		const child = await spawned('process.exit(4)');
		expect(await awaitListening(child, port, SETTLE_MS)).toEqual({
			kind: 'exited',
			code: 4,
		});
	});

	test('answers silent once the time is up, the child left running', async () => {
		const port = await freePort();
		const child = await spawned('setInterval(() => {}, 1e6)');
		expect(await awaitListening(child, port, 200)).toEqual({
			kind: 'silent',
		});
		expect(groupAlive(child.pid)).toBe(true);
	});

	test('answers silent when the wait is called off', async () => {
		const port = await freePort();
		const child = await spawned('setInterval(() => {}, 1e6)');
		const off = new AbortController();
		setTimeout(() => off.abort(), 100);
		const sent = Date.now();
		expect(
			await awaitListening(child, port, SETTLE_MS, off.signal),
		).toEqual({ kind: 'silent' });
		expect(Date.now() - sent).toBeLessThan(SETTLE_MS / 2);
	});
});

describe('listenWithRetry', () => {
	test('starts again a child that exits before it listens', async () => {
		const port = await freePort();
		let starts = 0;
		const { child, outcome } = await listenWithRetry(
			() => {
				starts++;
				return spawned(
					starts < 3 ? 'process.exit(255)' : listener(port),
				);
			},
			port,
			{ timeoutMs: SETTLE_MS, retryMs: RETRY_MS },
		);
		expect(outcome).toEqual({ kind: 'listening' });
		expect(starts).toBe(3);
		expect(child).toBe(started.at(-1)!);
	});

	test('answers the last exit once the time is up', async () => {
		const port = await freePort();
		let starts = 0;
		const { outcome } = await listenWithRetry(
			() => {
				starts++;
				return spawned('process.exit(255)');
			},
			port,
			{ timeoutMs: 400, retryMs: RETRY_MS },
		);
		expect(outcome).toEqual({ kind: 'exited', code: 255 });
		expect(starts).toBeGreaterThan(1);
	});

	test('stops a child still silent at the deadline', async () => {
		const port = await freePort();
		const { child, outcome } = await listenWithRetry(
			() => spawned('setInterval(() => {}, 1e6)'),
			port,
			{ timeoutMs: 200, retryMs: RETRY_MS },
		);
		expect(outcome).toEqual({ kind: 'silent' });
		expect(await child.exited).toBe(143);
	});

	test('starts nothing more once called off, and leaves the child to its caller', async () => {
		const port = await freePort();
		const off = new AbortController();
		let starts = 0;
		const { child, outcome } = await listenWithRetry(
			() => {
				starts++;
				if (starts === 2) off.abort();
				return spawned(
					starts === 1
						? 'process.exit(1)'
						: 'setInterval(() => {}, 1e6)',
				);
			},
			port,
			{ timeoutMs: SETTLE_MS, retryMs: RETRY_MS, signal: off.signal },
		);
		expect(outcome).toEqual({ kind: 'silent' });
		expect(starts).toBe(2);
		expect(groupAlive(child.pid)).toBe(true);
	});

	test('does not start again once called off after an exit', async () => {
		const port = await freePort();
		const off = new AbortController();
		let starts = 0;
		const { outcome } = await listenWithRetry(
			async () => {
				starts++;
				const child = await spawned('process.exit(2)');
				void child.exited.then(() => off.abort());
				return child;
			},
			port,
			{ timeoutMs: SETTLE_MS, retryMs: RETRY_MS, signal: off.signal },
		);
		expect(outcome).toEqual({ kind: 'exited', code: 2 });
		expect(starts).toBe(1);
	});
});
