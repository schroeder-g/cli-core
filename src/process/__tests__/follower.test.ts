import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import {
	appendFileSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compilePattern, LOG_ERROR, LogFollower } from '../follower.ts';
import type { LogSource } from '../follower.ts';
import { runMarker } from '../logfiles.ts';

const MARKER = runMarker('nt');

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cli-core-follower-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const texts = (logs: LogFollower) =>
	logs.snapshot().lines.map(line => `${line.name}: ${line.text}`);

const until = async (done: () => boolean): Promise<void> => {
	const deadline = Date.now() + 2000;
	while (!done() && Date.now() < deadline) await Bun.sleep(20);
};

describe('LogFollower', () => {
	test('follows each source from where it left off, whole lines only, escapes stripped', () => {
		const api = join(dir, 'api.log');
		const web = join(dir, 'web.log');
		writeFileSync(api, 'one\n\u001b[31mtwo\u001b[0m\npart');
		const logs = new LogFollower(() => [
			{ name: 'phases', file: join(dir, 'phases.log') },
			{ name: 'api', file: api },
			{ name: 'web', file: web },
		]);
		logs.read();
		expect(texts(logs)).toEqual(['api: one', 'api: two']);
		expect(logs.snapshot().names).toEqual(['phases', 'api', 'web']);
		appendFileSync(api, 'ial\r\n');
		writeFileSync(web, 'hello\n');
		logs.read();
		expect(texts(logs)).toEqual([
			'api: one',
			'api: two',
			'api: partial',
			'web: hello',
		]);
		const seqs = logs.snapshot().lines.map(line => line.seq);
		expect(seqs).toEqual([0, 1, 2, 3]);
	});

	test('a file two sources share is read once, under the first, which alone is listed', () => {
		const shared = join(dir, 'phases.log');
		writeFileSync(shared, 'up\n');
		const logs = new LogFollower(() => [
			{ name: 'phases', file: shared },
			{ name: 'postgres', file: shared },
		]);
		logs.read();
		expect(texts(logs)).toEqual(['phases: up']);
		expect(logs.snapshot().names).toEqual(['phases']);
	});

	test('a truncated file is read again from its start', () => {
		const file = join(dir, 'api.log');
		writeFileSync(file, 'first run\n');
		const logs = new LogFollower(() => [{ name: 'api', file }]);
		logs.read();
		writeFileSync(file, 'again\n');
		logs.read();
		expect(texts(logs)).toEqual(['api: first run', 'api: again']);
	});

	test('publishes one snapshot per change, and none when nothing changed', () => {
		const file = join(dir, 'api.log');
		const logs = new LogFollower(() => [{ name: 'api', file }]);
		let told = 0;
		logs.subscribe(() => told++);
		logs.read();
		expect(told).toBe(1);
		logs.read();
		expect(told).toBe(1);
		writeFileSync(file, 'x\n');
		logs.read();
		expect(told).toBe(2);
		const before = logs.snapshot();
		logs.read();
		expect(logs.snapshot()).toBe(before);
	});

	test('the filter hides names and matches a pattern, case-insensitive, and says why one is bad', () => {
		const api = join(dir, 'api.log');
		const web = join(dir, 'web.log');
		writeFileSync(api, 'GET /health 200\nerror: boom\n');
		writeFileSync(web, 'GET /Health 200\n');
		const sources: LogSource[] = [
			{ name: 'api', file: api },
			{ name: 'web', file: web },
		];
		const logs = new LogFollower(() => sources);
		logs.read();
		expect(logs.snapshot().visible).toHaveLength(3);
		logs.setPattern('health');
		expect(logs.snapshot().visible.map(line => line.name)).toEqual([
			'api',
			'web',
		]);
		logs.toggle('api');
		expect(logs.snapshot().hidden).toEqual(new Set(['api']));
		expect(logs.snapshot().visible.map(line => line.name)).toEqual([
			'web',
		]);
		logs.toggle('api');
		logs.toggle('web');
		logs.showAll();
		expect(logs.snapshot().hidden.size).toBe(0);
		logs.setPattern('(');
		expect(logs.snapshot().pattern).toBe('(');
		expect(logs.snapshot().regex).toBeUndefined();
		expect(logs.snapshot().problem).toContain('missing )');
		expect(logs.snapshot().visible).toHaveLength(3);
		logs.setPattern('');
		expect(logs.snapshot().problem).toBeUndefined();
	});

	test('new lines join the filtered lines and the error count as they come, and leave them past the cap', () => {
		const api = join(dir, 'api.log');
		writeFileSync(api, 'error: first\nGET /health 200\n');
		const logs = new LogFollower(() => [{ name: 'api', file: api }], {
			keep: 50,
		});
		logs.read();
		logs.setPattern('health');
		expect(logs.snapshot().errors).toBe(1);
		appendFileSync(api, 'GET /health 503\nFATAL: down\n');
		logs.read();
		expect(logs.snapshot().visible.map(line => line.text)).toEqual([
			'GET /health 200',
			'GET /health 503',
		]);
		expect(logs.snapshot().errors).toBe(2);
		appendFileSync(api, 'GET /health 200\n'.repeat(50));
		logs.read();
		const { lines, visible, errors } = logs.snapshot();
		expect(lines).toHaveLength(50);
		expect(visible).toHaveLength(50);
		expect(visible[0]?.seq).toBe(lines[0]?.seq);
		expect(errors).toBe(0);
	});

	test('counts a line with an error level word as an error, whatever its case, and an err field as none', () => {
		const file = join(dir, 'api.log');
		writeFileSync(
			file,
			[
				'ERROR boom',
				'panic: index out of range',
				'Exception in thread main',
				'fatal: not a repository',
				'err: connection refused',
				'level=warn err=timeout',
				'stderr closed',
			].join('\n') + '\n',
		);
		const logs = new LogFollower(() => [{ name: 'api', file }]);
		logs.read();
		expect(logs.snapshot().errors).toBe(4);
		expect(
			logs.snapshot().lines.filter(line => LOG_ERROR.test(line.text)),
		).toHaveLength(4);
	});

	test('tells each batch of new lines to a listener until it stops listening', () => {
		const file = join(dir, 'api.log');
		const logs = new LogFollower(() => [{ name: 'api', file }], {
			keep: 1,
		});
		const told: string[][] = [];
		const stop = logs.onLines(lines =>
			told.push(lines.map(line => line.text)),
		);
		writeFileSync(file, 'a\nb\n');
		logs.read();
		stop();
		appendFileSync(file, 'c\n');
		logs.read();
		expect(told).toEqual([['a', 'b']]);
	});

	test('follow starts at the end of a file already there and reads on a timer until closed', async () => {
		const file = join(dir, 'api.log');
		writeFileSync(file, 'an earlier run\n');
		const logs = new LogFollower(() => [{ name: 'api', file }], {
			intervalMs: 10,
		});
		logs.follow();
		expect(texts(logs)).toEqual([]);
		appendFileSync(file, 'late\n');
		await until(() => logs.snapshot().lines.length > 0);
		logs.close();
		expect(texts(logs)).toEqual(['api: late']);
		appendFileSync(file, 'after close\n');
		await Bun.sleep(50);
		expect(texts(logs)).toEqual(['api: late']);
	});

	test('follow starts a log it is told is running from its last run, given the marker', () => {
		const api = join(dir, 'api.log');
		const web = join(dir, 'web.log');
		const run = `${MARKER.line('api', new Date(0))}\nup\n`;
		writeFileSync(api, `old\n${run}`);
		writeFileSync(web, `${MARKER.line('web', new Date(0))}\nweb up\n`);
		const logs = new LogFollower(
			() => [
				{ name: 'api', file: api },
				{ name: 'web', file: web },
			],
			{ marker: MARKER },
		);
		logs.follow(name => name === 'api');
		logs.close();
		expect(texts(logs)).toEqual([
			`api: ${MARKER.line('api', new Date(0))}`,
			'api: up',
		]);
	});
});

describe('compilePattern', () => {
	test('compiles case-insensitive, says why a pattern does not, and takes empty as none', () => {
		expect(compilePattern('GET')).toEqual({
			regex: /GET/i,
			problem: undefined,
		});
		expect(compilePattern('[').regex).toBeUndefined();
		expect(compilePattern('[').problem).toBeString();
		expect(compilePattern('')).toEqual({
			regex: undefined,
			problem: undefined,
		});
	});
});
