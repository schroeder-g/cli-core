import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { Failure } from '../../core/errors.ts';
import { configureLogging } from '../../core/logging.ts';
import { startTimes } from '../identity.ts';
import { recordFile } from '../records.ts';

const EPOCH_START = 'Thu Jan  1 00:00:00 1970';

const ENTRY = z.object({
	name: z.string(),
	pid: z.number().int().positive(),
	startedAt: z.string(),
	port: z.number().int().positive().optional(),
});

type Entry = z.infer<typeof ENTRY>;

let dir = '';

let lines: string[] = [];

let sleeper: Bun.Subprocess;

const fileIn = () => join(dir, 'state', 'running.json');

const records = (
	options: Partial<Parameters<typeof recordFile<Entry>>[1]> = {},
) =>
	recordFile(fileIn(), {
		schema: ENTRY,
		nameOf: entry => entry.name,
		...options,
	});

const gonePid = async (): Promise<number> => {
	const gone = Bun.spawn(['true']);
	await gone.exited;
	return gone.pid;
};

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'cli-records-'));
	lines = [];
	await configureLogging('info', line => {
		lines.push(line);
	});
	sleeper = Bun.spawn(['sleep', '30']);
});

afterEach(async () => {
	sleeper.kill('SIGKILL');
	await sleeper.exited;
	rmSync(dir, { force: true, recursive: true });
});

describe('recordFile', () => {
	test('reads none while no file exists', () => {
		expect(records().read()).toEqual([]);
	});

	test('add stamps each process with the start time its pid carries now', async () => {
		const added = await records().add([
			{ name: 'api', pid: sleeper.pid, port: 8080 },
		]);
		const startedAt = (await startTimes([sleeper.pid])).get(
			sleeper.pid,
		);
		expect(added).toEqual([
			{
				name: 'api',
				pid: sleeper.pid,
				port: 8080,
				startedAt: startedAt!,
			},
		]);
		expect(records().read()).toEqual(added);
		expect(JSON.parse(readFileSync(fileIn(), 'utf8'))).toEqual({
			version: 1,
			records: added,
		});
	});

	test('add replaces the record of the same name and keeps the rest', async () => {
		const file = records();
		await file.add([
			{ name: 'api', pid: sleeper.pid, port: 1 },
			{ name: 'web', pid: sleeper.pid, port: 2 },
		]);
		await file.add([{ name: 'api', pid: sleeper.pid, port: 3 }]);
		expect(file.read().map(({ name, port }) => [name, port])).toEqual([
			['web', 2],
			['api', 3],
		]);
	});

	test('add leaves out a pid already gone, as nothing could stop it later', async () => {
		const added = await records().add([
			{ name: 'past', pid: await gonePid() },
		]);
		expect(added).toEqual([]);
		expect(records().read()).toEqual([]);
	});

	test('forget drops the named records, and the file with the last', async () => {
		const file = records();
		await file.add([
			{ name: 'api', pid: sleeper.pid },
			{ name: 'web', pid: sleeper.pid },
		]);
		file.forget(['api']);
		expect(file.read().map(entry => entry.name)).toEqual(['web']);
		file.forget(['web']);
		expect(existsSync(fileIn())).toBe(false);
	});

	test('a write replaces the file whole and leaves nothing beside it', async () => {
		const file = records();
		await file.add([{ name: 'api', pid: sleeper.pid }]);
		await file.add([{ name: 'web', pid: sleeper.pid }]);
		expect(readdirSync(join(dir, 'state'))).toEqual(['running.json']);
	});

	test('live answers the records whose groups live, and logs the rest as dropped', async () => {
		const file = records();
		const [api] = await file.add([{ name: 'api', pid: sleeper.pid }]);
		file.write([
			api!,
			{ name: 'reused', pid: sleeper.pid, startedAt: EPOCH_START },
			{ name: 'past', pid: await gonePid(), startedAt: EPOCH_START },
		]);
		expect((await file.live()).map(entry => entry.name)).toEqual([
			'api',
		]);
		expect(lines.some(line => line.includes('reused'))).toBe(true);
		expect(lines.some(line => line.includes('past'))).toBe(true);
		expect(file.read()).toHaveLength(3);
	});

	test('describe names each record, by the program’s own words when it gives them', async () => {
		const [api] = await records().add([
			{ name: 'api', pid: sleeper.pid, port: 8080 },
		]);
		expect(records().describe([api!, api!])).toBe(
			`api (pid ${sleeper.pid}), api (pid ${sleeper.pid})`,
		);
		expect(
			records({
				describe: entry => `${entry.name} on ${entry.port}`,
			}).describe([api!]),
		).toBe('api on 8080');
	});

	test('a format names the version and the field the records sit under', async () => {
		const file = records({ format: { version: 3, field: 'servers' } });
		const added = await file.add([{ name: 'api', pid: sleeper.pid }]);
		expect(JSON.parse(readFileSync(fileIn(), 'utf8'))).toEqual({
			version: 3,
			servers: added,
		});
		expect(() => records().read()).toThrow(Failure);
	});

	test('refuses a file it cannot read, naming it', () => {
		const file = records();
		file.write([
			{ name: 'api', pid: sleeper.pid, startedAt: EPOCH_START },
		]);
		for (const text of [
			'not json',
			'{"version": 1, "records": "none"}',
			'{"version": 2, "records": []}',
		]) {
			writeFileSync(fileIn(), text);
			expect(() => file.read()).toThrow(
				new RegExp(`^${fileIn()} is not a record this program reads`),
			);
		}
		expect(existsSync(fileIn())).toBe(true);
	});
});
