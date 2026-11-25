import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from 'bun:test';
import {
	appendFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { Failure } from '../../core/errors.ts';
import { INTERRUPTED } from '../../core/exit.ts';
import type { Secret } from '../../core/plan.ts';
import { configureLogging } from '../../core/logging.ts';
import { freePort } from '../../testing/ports.ts';
import { capture } from '../../testing/streams.ts';
import { busyPorts, portHolder, until, waitForPort } from '../ports.ts';
import { recordFile } from '../records.ts';
import type { RecordFile } from '../records.ts';
import { SpawnFailure } from '../spawn.ts';
import {
	launchDetached,
	stopRecorded,
	supervise,
} from '../supervise.ts';
import type { DetachedOptions, Supervised } from '../supervise.ts';
import {
	listener,
	live,
	pidFileIn,
	pidIn,
	SETTLE_MS,
	tree,
} from './trees.ts';

const SUPERVISE = join(import.meta.dir, '..', 'supervise.ts');

const RECORDS = join(import.meta.dir, '..', 'records.ts');

const LOGGING = join(import.meta.dir, '..', '..', 'core', 'logging.ts');

const NAMES: readonly string[] = ['api', 'web', 'docs'];

const GRACE_MS = 500;

const EPOCH_START = 'Thu Jan  1 00:00:00 1970';

const HINT = 'nt stop ends them';

const ENTRY = z.object({
	name: z.string(),
	pid: z.number().int().positive(),
	startedAt: z.string(),
	port: z.number().int().positive(),
	log: z.string(),
	flavour: z.string().optional(),
});

// Each test starts process trees, which a loaded machine slows past
// bun's 5 s default.
setDefaultTimeout(SETTLE_MS * 3);

type Entry = z.infer<typeof ENTRY>;

interface Served extends Supervised {
	readonly port: number;
	readonly flavour?: string;
}

let dir = '';

let lines: string[] = [];

// A listener no test started, which no stop may touch.
let bystander: Bun.Subprocess;

let bystanderPort = 0;

const pidFile = (name: string) => pidFileIn(dir, name);

const recordedPid = (name: string) => pidIn(pidFile(name));

const fixtures = async (trap = ''): Promise<Served[]> => {
	const served: Served[] = [];
	for (const name of NAMES) {
		const port = await freePort();
		served.push({
			name,
			port,
			step: tree(`Serve ${name}`, pidFile(name), port, trap),
		});
	}
	return served;
};

const records = (): RecordFile<Entry> =>
	recordFile(join(dir, 'state', 'running.json'), {
		schema: ENTRY,
		nameOf: entry => entry.name,
		describe: entry =>
			`${entry.name} (port ${entry.port}, pid ${entry.pid})`,
	});

const logFile = (proc: Served) => join(dir, 'logs', `${proc.name}.log`);

const detachedOptions = (): DetachedOptions<Served, Entry> => ({
	records: records(),
	logFile,
	record: (proc, pid, log) => ({
		name: proc.name,
		port: proc.port,
		pid,
		log,
		...(proc.flavour === undefined ? {} : { flavour: proc.flavour }),
	}),
	stopHint: HINT,
});

const detached = (served: readonly Served[]) =>
	launchDetached(served, detachedOptions());

const failureOf = async (run: Promise<unknown>): Promise<Error> => {
	try {
		await run;
	} catch (error) {
		return error as Error;
	}
	throw new Error('the run did not fail');
};

const allUp = async (served: readonly Supervised[]) => {
	const up = await Promise.all(
		served.map(({ port }) => waitForPort(port!, SETTLE_MS)),
	);
	expect(up).toEqual(served.map(() => true));
};

const allDown = async (served: readonly Served[]) => {
	expect(
		await live(served.map(({ name }) => recordedPid(name))),
	).toEqual([]);
	expect(await busyPorts(served, proc => proc.port)).toEqual([]);
};

const bystanderLives = async () => {
	expect(await live([bystander.pid])).toEqual([bystander.pid]);
	expect((await portHolder(bystanderPort))?.pid).toBe(bystander.pid);
};

const entry = (name: string, port: number, pid: number): Entry => ({
	name,
	port,
	pid,
	startedAt: EPOCH_START,
	log: join(dir, 'logs', `${name}.log`),
});

beforeAll(async () => {
	bystanderPort = await freePort();
	bystander = Bun.spawn(['bun', '-e', listener(bystanderPort)], {
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore',
	});
	expect(await waitForPort(bystanderPort, SETTLE_MS)).toBe(true);
});

afterAll(async () => {
	bystander.kill('SIGKILL');
	await bystander.exited;
});

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'cli-supervise-'));
	lines = [];
	await configureLogging('info', line => {
		lines.push(line);
	});
});

afterEach(async () => {
	await stopRecorded(records());
	rmSync(dir, { force: true, recursive: true });
});

describe('supervise, in the foreground', () => {
	test('an interrupt ends the processes and spares a bystander', async () => {
		const served = await fixtures();
		const session = supervise(served);
		await allUp(served);
		process.kill(process.pid, 'SIGINT');
		expect(await session).toBe(INTERRUPTED);
		await allDown(served);
		await bystanderLives();
	});

	test('prefixes each process’s lines with its name', async () => {
		const out = capture();
		const code = await supervise(
			[
				{
					name: 'once',
					step: { title: 'Say', cwd: '.', argv: ['echo', 'hello'] },
				},
			],
			{ streams: { stdout: out, stderr: out } },
		);
		expect(code).toBe(0);
		expect(out.text()).toBe('[once] hello\n');
	});

	test('a process that ignores the signal is killed after the grace', async () => {
		const served = await fixtures("process.on('SIGINT', () => {});");
		const session = supervise(served, { graceMs: GRACE_MS });
		await allUp(served);
		const sent = Date.now();
		process.kill(process.pid, 'SIGINT');
		expect(await session).toBe(INTERRUPTED);
		expect(Date.now() - sent).toBeGreaterThanOrEqual(GRACE_MS);
		expect(Date.now() - sent).toBeLessThan(SETTLE_MS);
		await allDown(served);
		await bystanderLives();
		expect(lines.some(line => line.includes('outlived'))).toBe(true);
	});

	test('a repeated interrupt kills the processes at once', async () => {
		const served = await fixtures("process.on('SIGINT', () => {});");
		const session = supervise(served);
		await allUp(served);
		const sent = Date.now();
		process.kill(process.pid, 'SIGINT');
		expect(
			await until(
				() => lines.some(line => line.includes('received; stopping')),
				SETTLE_MS,
			),
		).toBe(true);
		process.kill(process.pid, 'SIGINT');
		expect(await session).toBe(INTERRUPTED);
		expect(Date.now() - sent).toBeLessThan(SETTLE_MS / 2);
		await allDown(served);
		await bystanderLives();
	});

	test('a process exiting by itself ends the run with its code', async () => {
		const [first, ...rest] = await fixtures();
		const quitter: Served = {
			...first!,
			step: {
				...first!.step,
				argv: [
					'bun',
					'-e',
					`require('node:fs').writeFileSync(${JSON.stringify(pidFile(first!.name))}, String(process.pid)); await Bun.sleep(300); process.exit(3)`,
				],
			},
		};
		const session = supervise([quitter, ...rest]);
		await allUp(rest);
		expect(await session).toBe(3);
		await allDown(rest);
		await bystanderLives();
		expect(lines.some(line => line.includes('api exited with 3'))).toBe(
			true,
		);
	});

	test('a process that cannot start stops those already started', async () => {
		const [api, web] = await fixtures();
		// Read once api answers, so the spawn after it fails on a live group.
		const once: Secret = {
			ref: 'once api answers',
			resolve: async () => {
				await waitForPort(api!.port, SETTLE_MS);
				return '';
			},
		};
		const missing: Served = {
			...web!,
			step: {
				...web!.step,
				argv: ['no-such-program-here'],
				env: { AFTER: once },
			},
		};
		const failure = await failureOf(supervise([api!, missing]));
		expect(failure).toBeInstanceOf(SpawnFailure);
		await allDown([api!]);
		await bystanderLives();
	});
});

describe('launchDetached and stopRecorded', () => {
	test('records each process with what the program gives, and stopRecorded ends them', async () => {
		const served = await fixtures();
		const flavoured = served.map(proc => ({
			...proc,
			flavour: 'mint',
		}));
		expect(await detached(flavoured)).toBe(0);
		const recorded = records().read();
		expect(recorded.map(({ name }) => name)).toEqual([...NAMES]);
		for (const entry of recorded) {
			expect(entry.pid).toBe(recordedPid(entry.name));
			expect(entry.startedAt).not.toBe('');
			expect(entry.flavour).toBe('mint');
			expect(existsSync(entry.log)).toBe(true);
		}
		for (const { port } of served)
			expect(await portHolder(port)).toBeDefined();
		expect(lines.at(-1)).toContain(HINT);

		await stopRecorded(records());
		await allDown(served);
		await bystanderLives();
		expect(existsSync(records().path)).toBe(false);
	});

	test('runs beforeLaunch on each log before its process starts', async () => {
		const [api] = await fixtures();
		expect(
			await launchDetached([api!], {
				...detachedOptions(),
				beforeLaunch: (proc, log) => {
					appendFileSync(log, `--- ${proc.name}\n`);
				},
			}),
		).toBe(0);
		expect(readFileSync(logFile(api!), 'utf8')).toStartWith(
			'--- api\n',
		);
	});

	test('stopRecorded with names ends those and keeps the rest recorded', async () => {
		const [api, web, docs] = await fixtures();
		expect(await detached([api!, web!, docs!])).toBe(0);
		await stopRecorded(records(), { only: ['api', 'web'] });
		await allDown([api!, web!]);
		expect(await portHolder(docs!.port)).toBeDefined();
		expect(
			records()
				.read()
				.map(({ name }) => name),
		).toEqual(['docs']);
		await stopRecorded(records(), { only: ['docs'] });
		await allDown([docs!]);
		expect(existsSync(records().path)).toBe(false);
		await bystanderLives();
	});

	test('a second launch joins the record', async () => {
		const [api, web, docs] = await fixtures();
		expect(await detached([api!])).toBe(0);
		expect(await detached([web!, docs!])).toBe(0);
		expect(
			records()
				.read()
				.map(({ name }) => name),
		).toEqual([...NAMES]);
		await stopRecorded(records());
		await allDown([api!, web!, docs!]);
		await bystanderLives();
	});

	test('a process exiting before it answers fails naming the rest still running', async () => {
		const [api, web] = await fixtures();
		const quitter: Served = {
			...web!,
			step: {
				...web!.step,
				argv: ['bun', '-e', 'setTimeout(() => process.exit(1), 500)'],
			},
		};
		const failure = await failureOf(detached([api!, quitter]));
		expect(failure).toBeInstanceOf(Failure);
		expect(failure.message).toContain('web exited with 1');
		expect(failure.message).toContain(
			`still running, recorded in ${records().path}: api (port ${api!.port}`,
		);
		expect(failure.message).toEndWith(HINT);
		expect(
			records()
				.read()
				.map(({ name }) => name),
		).toEqual(['api', 'web']);
	});

	test('a process exiting before its start time is read fails naming its exit', async () => {
		const [api, web] = await fixtures();
		const quitter: Served = {
			...web!,
			step: { ...web!.step, argv: ['true'] },
		};
		const failure = await failureOf(detached([api!, quitter]));
		expect(failure).toBeInstanceOf(Failure);
		expect(failure.message).toStartWith(
			'web exited with 0 before answering',
		);
		expect(failure.message).toContain(
			`still running, recorded in ${records().path}: api (port ${api!.port}`,
		);
	});

	test('a process that cannot start fails naming those already started', async () => {
		const [api, web, docs] = await fixtures();
		const missing: Served = {
			...web!,
			step: { ...web!.step, argv: ['no-such-program-here'] },
		};
		const failure = await failureOf(detached([api!, missing, docs!]));
		expect(failure).toBeInstanceOf(Failure);
		expect(failure.message).toStartWith(
			'no-such-program-here could not start: not found on PATH',
		);
		expect(failure.message).toContain(
			`still running, recorded in ${records().path}: api (port ${api!.port}`,
		);
		expect(failure.message).toEndWith(HINT);
		expect(
			records()
				.read()
				.map(({ name }) => name),
		).toEqual(['api']);
		expect(await waitForPort(api!.port, SETTLE_MS)).toBe(true);
		expect(await portHolder(docs!.port)).toBeUndefined();
	});

	test('a launch returns to the shell while its processes run on', async () => {
		const [api] = await fixtures();
		const script = join(dir, 'detached.ts');
		await Bun.write(
			script,
			[
				`const { launchDetached } = await import(${JSON.stringify(SUPERVISE)});`,
				`const { recordFile } = await import(${JSON.stringify(RECORDS)});`,
				`const { configureLogging } = await import(${JSON.stringify(LOGGING)});`,
				"const { z } = await import('zod');",
				"await configureLogging('info');",
				`const records = recordFile(${JSON.stringify(records().path)}, { schema: z.looseObject({ name: z.string(), pid: z.number(), startedAt: z.string() }), nameOf: entry => entry.name });`,
				`const code = await launchDetached([${JSON.stringify(api)}], { records, logFile: () => ${JSON.stringify(logFile(api!))}, record: (proc, pid, log) => ({ name: proc.name, port: proc.port, pid, log }), stopHint: ${JSON.stringify(HINT)} });`,
				'process.exitCode = code;',
			].join('\n'),
		);
		const child = Bun.spawn(['bun', script], {
			cwd: import.meta.dir,
			stdin: 'ignore',
			stdout: 'ignore',
			stderr: 'pipe',
		});
		const [code, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		]);
		expect(code).toBe(0);
		expect(stderr).toContain(HINT);
		expect(await portHolder(api!.port)).toBeDefined();
		await stopRecorded(records());
		await allDown([api!]);
	});

	test('a group that outlived its leader is still stopped', async () => {
		const port = await freePort();
		const orphaning: Served = {
			name: 'api',
			port,
			step: {
				title: 'Serve api behind a leader that exits',
				cwd: '.',
				argv: [
					'sh',
					'-c',
					`bun -e ${JSON.stringify(listener(port))} & echo $! > ${JSON.stringify(pidFile('api'))}; sleep 0.3`,
				],
			},
		};
		expect(await detached([orphaning])).toBe(0);
		const [recorded] = records().read();
		expect(
			await until(
				async () => (await live([recorded!.pid])).length === 0,
				SETTLE_MS,
			),
		).toBe(true);
		expect((await portHolder(port))?.pid).toBe(recordedPid('api'));
		await stopRecorded(records());
		expect(await portHolder(port)).toBeUndefined();
		await bystanderLives();
	});

	test('stopRecorded skips a record another process has taken over', async () => {
		const gone = Bun.spawn(['true']);
		await gone.exited;
		records().write([
			entry('ghost', bystanderPort, bystander.pid),
			entry('past', 2, gone.pid),
		]);
		await stopRecorded(records());
		await bystanderLives();
		expect(existsSync(records().path)).toBe(false);
		expect(
			lines.some(
				line => line.startsWith('warning:') && line.includes('ghost'),
			),
		).toBe(true);
		expect(lines.some(line => line.includes('past'))).toBe(true);
	});

	test('stopRecorded refuses a record it cannot read', async () => {
		records().write([entry('api', 1, bystander.pid)]);
		writeFileSync(records().path, '{"records": "none"}');
		const failure = await failureOf(stopRecorded(records()));
		expect(failure).toBeInstanceOf(Failure);
		expect(failure.message).toContain(records().path);
		expect(existsSync(records().path)).toBe(true);
		rmSync(records().path);
	});

	test('stopRecorded reports nothing recorded', async () => {
		await stopRecorded(records());
		expect(
			lines.some(line => line.includes('nothing is recorded')),
		).toBe(true);
	});
});
