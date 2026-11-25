import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configureLogging } from '../../core/logging.ts';
import { freePort } from '../../testing/ports.ts';
import { stopGroup } from '../group.ts';
import { startTimes, standings } from '../identity.ts';
import { portHolder, until, waitForPort } from '../ports.ts';
import { groupAlive } from '../signals.ts';
import { spawnChild } from '../spawn.ts';
import type { ChildHandle } from '../spawn.ts';
import { live, pidFileIn, SETTLE_MS, tree } from './trees.ts';

const GRACE_MS = 300;

const IGNORES_TERM = "process.on('SIGTERM', () => {});";

// Each test starts process trees, which a loaded machine slows past
// bun's 5 s default.
setDefaultTimeout(SETTLE_MS * 3);

let dir = '';

let lines: string[] = [];

const started: ChildHandle[] = [];

/** A leader and its listening child, in a process group of their own. */
async function group(
	name: string,
	trap = '',
): Promise<{ child: ChildHandle; port: number }> {
	const port = await freePort();
	const child = await spawnChild(
		tree(name, pidFileIn(dir, name), port, trap),
		{ detached: true, output: { prefix: name } },
	);
	started.push(child);
	expect(await waitForPort(port, SETTLE_MS)).toBe(true);
	return { child, port };
}

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'cli-group-'));
	lines = [];
	await configureLogging('info', line => {
		lines.push(line);
	});
});

afterEach(() => {
	for (const child of started.splice(0))
		if (groupAlive(child.pid)) child.kill('SIGKILL');
	rmSync(dir, { force: true, recursive: true });
});

describe('stopGroup', () => {
	test('ends every member of the group, the listener its leader spawned too', async () => {
		const { child, port } = await group('api');
		await stopGroup(child.pid, { name: 'api' });
		expect(groupAlive(child.pid)).toBe(false);
		expect(await portHolder(port)).toBeUndefined();
		expect(lines.some(line => line.startsWith('warning:'))).toBe(false);
	});

	test('kills a group that outlives the grace, and says so', async () => {
		const { child } = await group('api', IGNORES_TERM);
		const sent = Date.now();
		await stopGroup(child.pid, { name: 'api', graceMs: GRACE_MS });
		expect(Date.now() - sent).toBeGreaterThanOrEqual(GRACE_MS);
		expect(groupAlive(child.pid)).toBe(false);
		expect(
			lines.some(
				line =>
					line.startsWith('warning:')
					&& line.includes('api outlived the 0.3 s grace'),
			),
		).toBe(true);
	});

	test('sends the signal it is given', async () => {
		const { child } = await group('api', IGNORES_TERM);
		await stopGroup(child.pid, {
			name: 'api',
			signal: 'SIGINT',
			graceMs: SETTLE_MS,
		});
		expect(groupAlive(child.pid)).toBe(false);
		expect(lines.some(line => line.includes('outlived'))).toBe(false);
	});

	test('answers at once for a group already gone', async () => {
		const { child } = await group('api');
		child.kill('SIGKILL');
		await child.exited;
		expect(await until(() => !groupAlive(child.pid), SETTLE_MS)).toBe(
			true,
		);
		const sent = Date.now();
		await stopGroup(child.pid, { name: 'api', graceMs: SETTLE_MS });
		expect(Date.now() - sent).toBeLessThan(GRACE_MS);
	});
});

describe('process identity', () => {
	test('startTimes reads each live pid once and leaves a gone one out', async () => {
		const { child } = await group('api');
		const gone = Bun.spawn(['true']);
		await gone.exited;
		const times = await startTimes([child.pid, gone.pid]);
		expect(times.get(child.pid)).toMatch(/\d{4}$/);
		expect(times.has(gone.pid)).toBe(false);
		expect((await startTimes([])).size).toBe(0);
	});

	test('standings tell a running pid from a reused, a leaderless and a gone one', async () => {
		const { child: running } = await group('running');
		const { child: orphaned } = await group('orphaned');
		const leader = orphaned.pid;
		const times = await startTimes([running.pid, leader]);
		const gone = Bun.spawn(['true']);
		await gone.exited;
		process.kill(leader, 'SIGKILL');
		expect(
			await until(
				async () => (await live([leader])).length === 0,
				SETTLE_MS,
			),
		).toBe(true);
		const records = [
			{ pid: running.pid, startedAt: times.get(running.pid)! },
			{ pid: running.pid, startedAt: 'Thu Jan  1 00:00:00 1970' },
			{ pid: leader, startedAt: times.get(leader)! },
			{ pid: gone.pid, startedAt: 'Thu Jan  1 00:00:00 1970' },
		];
		expect(
			(await standings(records)).map(({ standing }) => standing),
		).toEqual(['running', 'reused', 'leaderless', 'gone']);
	});
});
