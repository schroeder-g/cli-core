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
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { object } from '@optique/core/constructs';

import { fixture } from '../../core/__tests__/fixture.ts';
import { commands } from '../../core/command.ts';
import type { Context } from '../../core/command.ts';
import { Failure } from '../../core/errors.ts';
import { configureLogging } from '../../core/logging.ts';
import { shellLine } from '../../core/plan.ts';
import type { Plan, Secret, Step } from '../../core/plan.ts';
import {
	capture as captured,
	fixtureTree,
	stdin,
	testContext,
} from '../../testing/index.ts';
import { until } from '../ports.ts';
import { runPlan } from '../run.ts';
import { capture, spawnChild, SpawnFailure } from '../spawn.ts';

const RUN = join(import.meta.dir, '..', 'run.ts');

const SPAWN = join(import.meta.dir, '..', 'spawn.ts');

const LOGGING = join(import.meta.dir, '..', '..', 'core', 'logging.ts');

/** The package's root, what a relative `cwd` resolves against. */
const ROOT = join(import.meta.dir, '..', '..', '..');

const BIG = 1_048_577;

const PATTERN = Buffer.from(
	Uint8Array.from({ length: BIG }, (_, i) => i % 251),
);

const SECRET_VALUE = 'hunter2';

const SECRET_REF = 'op://vault/item/token';

/** How long a child gets to write a file the test waits for. */
const WRITE_MS = 5_000;

// Long enough to outlast the poll that detects the child's marker, so
// the signal lands while it still runs.
const CHILD_SLEEP_MS = 300;

let dir = '';

let lines: string[] = [];

const { leaf } = commands<Context>();

const ctx = testContext(ROOT);

const at = (name: string) => join(dir, name);

const bun = (
	title: string,
	code: string,
	rest: Partial<Step> = {},
): Step => ({ title, cwd: ROOT, argv: ['bun', '-e', code], ...rest });

/** A step that appends its title to the run's order file, then `code`. */
const noting = (title: string, code = ''): Step =>
	bun(
		title,
		`require('node:fs').appendFileSync(${JSON.stringify(at('order'))}, ${JSON.stringify(`${title}\n`)}); ${code}`,
	);

const order = () =>
	existsSync(at('order')) ? readFileSync(at('order'), 'utf8') : '';

const secret = (
	value = SECRET_VALUE,
): Secret & { reads: () => number } => {
	let reads = 0;
	return {
		ref: SECRET_REF,
		resolve: () => {
			reads++;
			return Promise.resolve(value);
		},
		reads: () => reads,
	};
};

/** Polls for a file a child writes, so a signal lands while it runs. */
const written = async (name: string) => {
	expect(await until(() => existsSync(at(name)), WRITE_MS)).toBe(true);
};

const marking = (title: string, then: string) =>
	noting(
		title,
		`require('node:fs').writeFileSync(${JSON.stringify(at('started'))}, ''); ${then}`,
	);

interface ChildRun {
	readonly proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
	readonly done: Promise<{
		readonly stdout: Buffer;
		readonly stderr: string;
		readonly code: number;
	}>;
}

/**
 * A script run as its own process, so its stdout is whatever the test
 * hands it: it loads the runner, logs at info to stderr, and ends the
 * way `main.ts` does, by `process.exitCode`. `plan` is JSON when it is
 * plain data, else `body` builds it. `through` pipes its stdout into a
 * command; `stderrTo` sends its stderr through a slowly read FIFO into
 * a file, so that stream is a pipe even under the pty.
 */
function startChild(
	opts: {
		readonly plan?: Plan;
		readonly body?: string;
		readonly pty?: boolean;
		readonly mergeStderr?: boolean;
		readonly readAfterMs?: number;
		readonly through?: readonly string[];
		readonly stderrTo?: string;
	} = {},
): ChildRun {
	const script = [
		`const { runPlan } = await import(${JSON.stringify(RUN)});`,
		`const { spawnChild } = await import(${JSON.stringify(SPAWN)});`,
		`const { configureLogging } = await import(${JSON.stringify(LOGGING)});`,
		`const fs = await import('node:fs');`,
		'await configureLogging("info");',
		`const ctx = { ...${JSON.stringify({ ...ctx, stdin: undefined, stdout: undefined, stderr: undefined })}, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };`,
		`const plan = ${JSON.stringify(opts.plan ?? { steps: [] })};`,
		opts.body ?? 'process.exitCode = await runPlan(plan, ctx);',
	].join('\n');
	const file = at('fixture.ts');
	writeFileSync(file, script);
	let cmd = ['bun', file];
	if (opts.mergeStderr)
		cmd = ['sh', '-c', 'exec "$@" 2>&1', 'sh', ...cmd];
	if (opts.through)
		cmd = [
			'sh',
			'-c',
			`exec "$@" | ${opts.through.join(' ')}`,
			'sh',
			...cmd,
		];
	if (opts.stderrTo) {
		const fifo = at('err.fifo');
		cmd = [
			'sh',
			'-c',
			'mkfifo "$1"; (sleep 0.3; cat "$1" > "$2") & f=$1; shift 2; "$@" 2>"$f"; wait',
			'sh',
			fifo,
			opts.stderrTo,
			...cmd,
		];
	}
	if (opts.pty)
		cmd =
			process.platform === 'darwin'
				? ['script', '-q', '/dev/null', ...cmd]
				: ['script', '-qec', shellLine(cmd), '/dev/null'];
	const proc = Bun.spawn({
		cmd,
		cwd: ROOT,
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const read = async () => {
		if (opts.readAfterMs) await Bun.sleep(opts.readAfterMs);
		return new Response(proc.stdout).arrayBuffer();
	};

	const done = Promise.all([
		read(),
		new Response(proc.stderr).text(),
		proc.exited,
	]).then(([stdout, stderr, code]) => ({
		stdout: Buffer.from(stdout),
		stderr,
		code,
	}));
	return { proc, done };
}

const inChild = (opts: Parameters<typeof startChild>[0] = {}) =>
	startChild(opts).done;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'cli-runner-'));
	lines = [];
	await configureLogging('info', line => {
		lines.push(line);
	});
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('runPlan', () => {
	test('logs each step before it runs', async () => {
		const { stdout, code } = await inChild({
			plan: {
				steps: [
					bun('first', 'console.log("first-out")'),
					bun('second', 'console.log("second-out"); process.exit(3)'),
					bun('third', 'console.log("third-out")'),
				],
				finally: [bun('last', 'console.log("last-out")')],
			},
			mergeStderr: true,
		});
		expect(code).toBe(3);
		expect(stdout.toString().split('\n').filter(Boolean)).toEqual([
			'info: # first',
			'$ bun -e \'console.log("first-out")\'',
			'  cwd: .',
			'first-out',
			'info: # second',
			'$ bun -e \'console.log("second-out"); process.exit(3)\'',
			'  cwd: .',
			'second-out',
			'info: # last',
			'$ bun -e \'console.log("last-out")\'',
			'  cwd: .',
			'last-out',
		]);
	});

	test("exits with the failing step's code through the program's run, its children on the injected stdout", async () => {
		const plan: Plan = {
			steps: [
				noting('first', 'console.log("first-out")'),
				noting('second', 'process.exit(3)'),
			],
			finally: [noting('last', 'console.log("last-out")')],
		};
		const program = fixtureTree(
			leaf('fx', 'Runs the fixture plan.', object({}), () =>
				Promise.resolve(plan),
			),
		);
		const stdout = captured();
		const stderr = captured();
		const code = await fixture.run(['fx'], {
			program,
			stdin: stdin({ tty: false }),
			stdout,
			stderr,
		});
		expect(code).toBe(3);
		expect(order()).toBe('first\nsecond\nlast\n');
		expect(stdout.text()).toBe('first-out\nlast-out\n');
		expect(stderr.text()).toContain('info: # second\n');
	});

	test('a failing finally step fails a plan that succeeded', async () => {
		const plan: Plan = {
			steps: [noting('first')],
			finally: [bun('last', 'process.exit(5)')],
		};
		expect(await runPlan(plan, ctx)).toBe(5);
	});

	test('a failed run keeps its code over a finally failure, logged', async () => {
		const plan: Plan = {
			steps: [bun('first', 'process.exit(3)')],
			finally: [bun('last', 'process.exit(5)'), noting('cleanup')],
		};
		expect(await runPlan(plan, ctx)).toBe(3);
		expect(order()).toBe('cleanup\n');
		expect(lines).toContain('warning: finally step last exited 5');
	});

	test('runs every finally step past one that throws', async () => {
		const rejecting: Step = {
			...noting('broken'),
			unless: {
				describe: 'op is signed in',
				check: () => Promise.reject(new Failure('op: not signed in')),
			},
		};
		const succeeded: Plan = {
			steps: [noting('first')],
			finally: [rejecting, noting('cleanup')],
		};
		await expect(runPlan(succeeded, ctx)).rejects.toThrow(
			'op: not signed in',
		);
		expect(order()).toBe('first\ncleanup\n');

		rmSync(at('order'));
		const failed: Plan = {
			steps: [{ ...noting('first'), unless: rejecting.unless }],
			finally: [rejecting, noting('cleanup')],
		};
		await expect(runPlan(failed, ctx)).rejects.toThrow(
			'op: not signed in',
		);
		expect(order()).toBe('cleanup\n');
		expect(lines).toContain(
			'error: finally step broken failed: op: not signed in',
		);
	});

	test("forwards a child's whole output", async () => {
		await Bun.write(at('pattern.bin'), PATTERN);
		const { stdout, stderr, code } = await inChild({
			plan: {
				steps: [
					{ title: 'big', cwd: ROOT, argv: ['cat', at('pattern.bin')] },
				],
			},
			readAfterMs: 300,
		});
		expect(code).toBe(0);
		expect(stderr).toStartWith('info: # big\n');
		expect(stdout.length).toBe(BIG);
		expect(stdout.equals(PATTERN)).toBe(true);
	});

	test("sends a step's stdout to stderr when the step says so", async () => {
		const { stdout, stderr, code } = await inChild({
			plan: {
				steps: [
					{
						title: 'setup',
						cwd: ROOT,
						argv: ['echo', 'hydrated'],
						stdout: 'stderr',
					},
					{ title: 'payload', cwd: ROOT, argv: ['echo', '{}'] },
				],
			},
		});
		expect(code).toBe(0);
		expect(stdout.toString()).toBe('{}\n');
		expect(stderr.toString()).toContain('hydrated\n');
	});

	test('keeps the terminal for a child', async () => {
		const { stdout, code } = await inChild({
			plan: {
				steps: [
					bun(
						'tty',
						'console.log("child tty: " + process.stdout.isTTY)',
					),
				],
			},
			pty: true,
		});
		expect(code).toBe(0);
		expect(stdout.toString()).toContain('child tty: true');
	});

	test('pipes the stream that is not a terminal', async () => {
		await Bun.write(at('pattern.bin'), PATTERN);
		const { code } = await inChild({
			plan: {
				steps: [
					{
						title: 'loud',
						cwd: ROOT,
						argv: ['sh', '-c', `cat ${at('pattern.bin')} >&2`],
					},
				],
			},
			body: `process.exitCode = await runPlan(plan, ctx);
				fs.writeFileSync(${JSON.stringify(at('code'))}, String(process.exitCode));`,
			stderrTo: at('err.bin'),
			pty: true,
		});
		expect(code).toBe(0);
		expect(readFileSync(at('code'), 'utf8')).toBe('0');
		const err = readFileSync(at('err.bin'));
		expect(err.length).toBeGreaterThanOrEqual(BIG);
		expect(err.subarray(err.length - BIG).equals(PATTERN)).toBe(true);
	});

	test('waits for the child when the reader closes early', async () => {
		await Bun.write(at('pattern.bin'), PATTERN);
		const { code } = await inChild({
			plan: {
				steps: [
					{
						title: 'cut',
						cwd: ROOT,
						argv: [
							'sh',
							'-c',
							`cat ${at('pattern.bin')}; sleep 0.5; echo ended >> ${at('order')}`,
						],
					},
				],
				finally: [noting('finally')],
			},
			body: `process.exitCode = await runPlan(plan, ctx);
				fs.writeFileSync(${JSON.stringify(at('code'))}, String(process.exitCode));`,
			through: ['head', '-c', '10'],
		});
		expect(code).toBe(0);
		expect(readFileSync(at('code'), 'utf8')).toBe('0');
		expect(order()).toBe('ended\nfinally\n');
	});

	test('prints the plan and runs nothing under dryRun', async () => {
		const { stdout, code } = await inChild({
			plan: { steps: [noting('first')], finally: [noting('last')] },
			body: 'ctx.dryRun = true; process.exitCode = await runPlan(plan, ctx);',
		});
		expect(code).toBe(0);
		expect(order()).toBe('');
		expect(stdout.toString()).toStartWith('# first\n$ bun -e ');
		expect(stdout.toString()).toContain('finally:\n# last\n');
	});

	test('skips a step its check excuses', async () => {
		const plan: Plan = {
			steps: [
				{
					...noting('guarded'),
					unless: {
						describe: 'the marker exists',
						check: () => Promise.resolve(true),
					},
				},
				noting('after'),
			],
		};
		expect(await runPlan(plan, ctx)).toBe(0);
		expect(order()).toBe('after\n');
		expect(lines).toContain(
			'info: skipping guarded: the marker exists',
		);
		expect(lines.some(line => line.includes('# guarded'))).toBe(false);
	});

	test('resolves secrets at spawn', async () => {
		const token = secret();
		const plan: Plan = {
			steps: [
				{
					title: 'reads the token',
					cwd: ROOT,
					argv: [
						'bun',
						'-e',
						`require('node:fs').writeFileSync(${JSON.stringify(at('seen'))}, process.env.TOKEN + ' ' + process.env.AGAIN)`,
					],
					env: { TOKEN: token, AGAIN: token, PLAIN: 'shown' },
				},
			],
		};
		expect(await runPlan(plan, ctx)).toBe(0);
		expect(token.reads()).toBe(1);
		expect(readFileSync(at('seen'), 'utf8')).toBe('hunter2 hunter2');
		expect(lines.join('\n')).not.toContain(SECRET_VALUE);
		expect(lines.join('\n')).toContain(`TOKEN ← ${SECRET_REF}`);
	});

	test('writes no secret on any stream, the log file included', async () => {
		const { stdout, stderr, code } = await inChild({
			body: `const token = { ref: ${JSON.stringify(SECRET_REF)}, resolve: () => Promise.resolve(${JSON.stringify(SECRET_VALUE)}) };
				const step = { title: 'reads', cwd: ${JSON.stringify(ROOT)}, argv: ['bun', '-e', 'console.log("got " + process.env.TOKEN.length); console.error("err " + process.env.TOKEN.length)'], env: { TOKEN: token } };
				const code = await runPlan({ steps: [step] }, ctx);
				const logged = await spawnChild(step, { output: { logFile: ${JSON.stringify(at('server.log'))} } });
				const nul = { ...token, resolve: () => Promise.resolve('hunter2\\0tail') };
				const bad = await runPlan({ steps: [{ ...step, env: { TOKEN: nul } }] }, ctx).catch(error => { console.error('refused: ' + error.message); return -1; });
				process.exitCode = code + await logged.exited + (bad === -1 ? 0 : 100);`,
		});
		expect(code).toBe(0);
		const written = stdout.toString() + stderr;
		expect(written).toContain('got 7');
		expect(written).toContain(`TOKEN ← ${SECRET_REF}`);
		expect(written).toContain('refused: TOKEN holds a NUL byte');
		expect(written).not.toContain(SECRET_VALUE);
		expect(readFileSync(at('server.log'), 'utf8')).toBe(
			'got 7\nerr 7\n',
		);
	});

	test('returns 127 for a missing program', async () => {
		const plan: Plan = {
			steps: [
				{
					title: 'missing',
					cwd: ROOT,
					argv: ['no-such-program', '--flag'],
				},
			],
			finally: [noting('last')],
		};
		expect(await runPlan(plan, ctx)).toBe(127);
		expect(order()).toBe('last\n');
		expect(lines).toContain(
			'error: no-such-program could not start: not found on PATH',
		);
	});

	test('names a missing working directory, not the program', async () => {
		const plan: Plan = {
			steps: [
				{ title: 'lost', cwd: '/nope/dir', argv: ['bun', '-e', ''] },
			],
			finally: [noting('last')],
		};
		await expect(runPlan(plan, ctx)).rejects.toThrow(
			'/nope/dir does not exist, so bun cannot run there',
		);
		expect(order()).toBe('last\n');
	});

	test("resolves a relative cwd against the run's root", async () => {
		const plan: Plan = {
			steps: [
				{
					title: 'here',
					cwd: 'src',
					argv: [
						'bun',
						'-e',
						`require('node:fs').writeFileSync(${JSON.stringify(at('cwd'))}, process.cwd())`,
					],
				},
			],
		};
		expect(await runPlan(plan, ctx)).toBe(0);
		expect(readFileSync(at('cwd'), 'utf8')).toBe(join(ROOT, 'src'));
	});

	test('returns 128 + n for a child a signal killed', async () => {
		const plan: Plan = {
			steps: [bun('killed', 'process.kill(process.pid, "SIGTERM")')],
		};
		expect(await runPlan(plan, ctx)).toBe(143);
	});

	test.each([
		['SIGINT', 130],
		['SIGTERM', 143],
		['SIGHUP', 129],
	] as const)(
		'ignores %s while a child runs, then answers %i',
		async (signal, expected) => {
			const run = startChild({
				plan: {
					steps: [
						marking('slow', `await Bun.sleep(${CHILD_SLEEP_MS})`),
						noting('after'),
					],
					finally: [noting('finally')],
				},
			});
			await written('started');
			run.proc.kill(signal);
			const { code } = await run.done;
			expect(code).toBe(expected);
			expect(order()).toBe('slow\nfinally\n');
		},
	);

	test("an interrupt wins over the child's own code", async () => {
		const run = startChild({
			plan: {
				steps: [
					marking(
						'slow',
						`await Bun.sleep(${CHILD_SLEEP_MS}); process.exit(7)`,
					),
				],
			},
		});
		await written('started');
		run.proc.kill('SIGINT');
		expect((await run.done).code).toBe(130);
	});

	test('an interrupt during a check still runs finally', async () => {
		const run = startChild({
			plan: { steps: [noting('never')], finally: [noting('finally')] },
			body: `plan.steps[0].unless = { describe: 'a slow check', check: async () => { fs.writeFileSync(${JSON.stringify(at('started'))}, ''); await Bun.sleep(${CHILD_SLEEP_MS}); return false; } };
				process.exitCode = await runPlan(plan, ctx);`,
		});
		await written('started');
		run.proc.kill('SIGINT');
		expect((await run.done).code).toBe(130);
		expect(order()).toBe('finally\n');
	});

	test('an interrupt during a secret spawns nothing more', async () => {
		const run = startChild({
			plan: { steps: [noting('never')], finally: [noting('finally')] },
			body: `plan.steps[0].env = { TOKEN: { ref: 'op://x', resolve: async () => { fs.writeFileSync(${JSON.stringify(at('started'))}, ''); await Bun.sleep(${CHILD_SLEEP_MS}); return 'v'; } } };
				process.exitCode = await runPlan(plan, ctx);`,
		});
		await written('started');
		run.proc.kill('SIGINT');
		expect((await run.done).code).toBe(130);
		expect(order()).toBe('finally\n');
	});
});

describe('spawnChild', () => {
	test('prefixes each line under prefix', async () => {
		const { stdout, stderr, code } = await inChild({
			body: `const child = await spawnChild(
				{ title: 'api', cwd: ${JSON.stringify(ROOT)}, argv: ['bun', '-e', 'console.log("one\\\\ntwo"); console.error("three"); process.stdout.write("four")'] },
				{ output: { prefix: 'api' } },
			);
			process.exitCode = await child.exited;`,
		});
		expect(code).toBe(0);
		expect(stdout.toString()).toBe(
			'[api] one\n[api] two\n[api] four\n',
		);
		expect(stderr).toBe('[api] three\n');
	});

	test('appends both streams to logFile, private, beside the cwd', async () => {
		await Bun.write(at('server.log'), 'earlier\n');
		const child = await spawnChild(
			{
				title: 'server',
				cwd: dir,
				argv: ['bun', '-e', 'console.log("out"); console.error("err")'],
			},
			{ output: { logFile: 'server.log' } },
		);
		expect(await child.exited).toBe(0);
		expect(readFileSync(at('server.log'), 'utf8')).toBe(
			'earlier\nout\nerr\n',
		);
		const fresh = await spawnChild(
			bun('server', 'console.log("out")'),
			{
				output: { logFile: at('fresh.log') },
			},
		);
		expect(await fresh.exited).toBe(0);
		expect(statSync(at('fresh.log')).mode & 0o777).toBe(0o600);
	});

	test('refuses a log file it cannot open, and a symlink', async () => {
		await expect(
			spawnChild(bun('server', ''), {
				output: { logFile: at('missing/server.log') },
			}),
		).rejects.toThrow(
			`${at('missing/server.log')} cannot be opened for the log: ENOENT`,
		);
		symlinkSync(at('elsewhere.log'), at('link.log'));
		await expect(
			spawnChild(bun('server', ''), {
				output: { logFile: at('link.log') },
			}),
		).rejects.toThrow('cannot be opened for the log: ELOOP');
	});

	test('rejects with SpawnFailure, code 127, for a missing program', async () => {
		const rejection = spawnChild({
			title: 'missing',
			cwd: ROOT,
			argv: ['no-such-program'],
		});
		await expect(rejection).rejects.toBeInstanceOf(SpawnFailure);
		await expect(rejection).rejects.toHaveProperty('code', 127);
	});

	test('starts a new process group under detached, and kills it', async () => {
		const child = await spawnChild(
			{
				title: 'server',
				cwd: ROOT,
				argv: ['sh', '-c', 'sleep 30 & wait'],
			},
			{ detached: true, output: { logFile: at('server.log') } },
		);
		const group = await capture([
			'ps',
			'-o',
			'pgid=',
			'-p',
			String(child.pid),
		]);
		expect(Number(group.stdout.trim())).toBe(child.pid);
		child.kill('SIGTERM');
		expect(await child.exited).toBe(143);
		await Bun.sleep(100);
		expect(
			(await capture(['pgrep', '-g', String(child.pid)])).code,
		).toBe(1);
	});

	test('release lets the parent exit while a detached child serves', async () => {
		const run = startChild({
			body: `const server = await spawnChild(
				{ title: 'server', cwd: ${JSON.stringify(ROOT)}, argv: ['bun', '-e', 'const s = Bun.serve({ port: 0, fetch: () => new Response("alive") }); require("node:fs").writeFileSync(${JSON.stringify(at('port'))}, String(s.port));'] },
				{ detached: true, output: { logFile: ${JSON.stringify(at('server.log'))} } },
			);
			server.release();
			fs.writeFileSync(${JSON.stringify(at('pid'))}, String(server.pid));
			process.exitCode = 0;`,
		});
		try {
			const { code } = await run.done;
			expect(code).toBe(0);
			await written('port');
			const port = readFileSync(at('port'), 'utf8');
			const answer = await fetch(`http://127.0.0.1:${port}/`);
			expect(await answer.text()).toBe('alive');
		} finally {
			if (existsSync(at('pid')))
				process.kill(
					-Number(readFileSync(at('pid'), 'utf8')),
					'SIGTERM',
				);
		}
	});

	test('release is a no-op on a child that is not detached', async () => {
		const child = await spawnChild(
			bun('quick', 'console.log("done")'),
			{
				output: { prefix: 'quick' },
			},
		);
		child.release();
		expect(await child.exited).toBe(0);
	});

	test('passes the step env over the process env', async () => {
		process.env.RUNNER_TEST = 'inherited';
		const child = await spawnChild({
			title: 'env',
			cwd: ROOT,
			argv: [
				'bun',
				'-e',
				`require('node:fs').writeFileSync(${JSON.stringify(at('env'))}, process.env.RUNNER_TEST)`,
			],
			env: { RUNNER_TEST: 'stepped' },
		});
		expect(await child.exited).toBe(0);
		expect(readFileSync(at('env'), 'utf8')).toBe('stepped');
	});
});

describe('capture', () => {
	test('returns the code and both streams', async () => {
		const result = await capture(
			[
				'bun',
				'-e',
				'console.log("out"); console.error("err"); process.exit(4)',
			],
			{ cwd: ROOT },
		);
		expect(result).toEqual({
			code: 4,
			stdout: 'out\n',
			stderr: 'err\n',
		});
	});

	test('answers 128 + n for a signalled program', async () => {
		const result = await capture([
			'bun',
			'-e',
			'process.kill(process.pid, "SIGTERM")',
		]);
		expect(result.code).toBe(143);
	});

	test("runs with env over the program's", async () => {
		const argv = ['bun', '-e', 'console.log(process.env.CAPTURE_TEST)'];
		process.env.CAPTURE_TEST = 'inherited';
		try {
			expect((await capture(argv)).stdout).toBe('inherited\n');
			expect(
				(await capture(argv, { env: { CAPTURE_TEST: 'given' } }))
					.stdout,
			).toBe('given\n');
		} finally {
			delete process.env.CAPTURE_TEST;
		}
	});

	test('rejects a missing program with 127, and a missing directory', async () => {
		const missing = capture(['no-such-program']);
		await expect(missing).rejects.toBeInstanceOf(SpawnFailure);
		await expect(missing).rejects.toHaveProperty('code', 127);
		await expect(missing).rejects.toThrow(
			'no-such-program could not start: not found on PATH',
		);
		const lost = capture(['git', 'status'], { cwd: '/nope/dir' });
		await expect(lost).rejects.toBeInstanceOf(Failure);
		await expect(lost).rejects.toThrow(
			'/nope/dir does not exist, so git cannot run there',
		);
	});
});
