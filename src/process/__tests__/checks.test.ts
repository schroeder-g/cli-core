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
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FAILED } from '../../core/exit.ts';
import { capture } from '../../testing/index.ts';
import { allInOrder, loggedCheck, runChecks } from '../checks.ts';
import type { Check, CheckOutcome } from '../checks.ts';

const SECONDS = String.raw`\d+\.\d s`;

let dir = '';

const at = (name: string) => join(dir, name);

const sh = (script: string): readonly string[] => ['sh', '-c', script];

/** A promise and the function that settles it, for a test to time. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const answering = (name: string, outcome: CheckOutcome): Check => ({
	name,
	run: () => Promise.resolve(outcome),
});

const lines = (text: string) => text.split('\n').filter(Boolean);

beforeEach(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), 'cli-checks-')));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('allInOrder', () => {
	test('starts every task at once and hands each result on in the order given', async () => {
		const first = deferred<string>();
		const second = deferred<string>();
		const started: string[] = [];
		const handed: string[] = [];
		const done = allInOrder(
			[
				{ name: 'first', answer: first.promise },
				{ name: 'second', answer: second.promise },
			],
			({ name, answer }) => {
				started.push(name);
				return answer;
			},
			(result, { name }) => handed.push(`${name}=${result}`),
		);
		expect(started).toEqual(['first', 'second']);
		second.resolve('b');
		await Bun.sleep(0);
		expect(handed).toEqual([]);
		first.resolve('a');
		await done;
		expect(handed).toEqual(['first=a', 'second=b']);
	});

	test('hands on a result once it and every one before it have settled, before the rest', async () => {
		const last = deferred<string>();
		const handed: string[] = [];
		const done = allInOrder(
			[Promise.resolve('a'), last.promise],
			answer => answer,
			result => handed.push(result),
		);
		await Bun.sleep(0);
		expect(handed).toEqual(['a']);
		last.resolve('b');
		await done;
		expect(handed).toEqual(['a', 'b']);
	});

	test('rejects with the first error in the order given, after handing on the results before it', async () => {
		const handed: string[] = [];
		const done = allInOrder(
			['a', 'b', 'c'],
			async name => {
				if (name === 'a') return name;
				if (name === 'b') {
					await Bun.sleep(5);
					throw new Error('b broke');
				}
				throw new Error('c broke');
			},
			result => handed.push(result),
		);
		await expect(done).rejects.toThrow('b broke');
		expect(handed).toEqual(['a']);
	});
});

describe('runChecks', () => {
	test('reports each check in the order given, a failure with its fix and output, and fails the run', async () => {
		const slow = deferred<CheckOutcome>();
		const stdout = capture();
		const code = runChecks(
			[
				{ name: 'slow', run: () => slow.promise },
				answering('broken', {
					ok: false,
					detail: 'exit 3',
					fix: 'read the log',
					output: ['first line', 'the reason'],
				}),
				answering('fine', { ok: true, detail: '1.2.3' }),
			],
			stdout,
		);
		await Bun.sleep(0);
		expect(stdout.text()).toBe('');
		slow.resolve({ ok: true, detail: 'took a while' });
		expect(await code).toBe(FAILED);
		expect(lines(stdout.text())).toEqual([
			'✓ slow took a while',
			'✗ broken exit 3 — read the log',
			'    first line',
			'    the reason',
			'✓ fine 1.2.3',
			'1 of 3 checks failed: broken',
		]);
	});

	test('answers 0 when every check passes, and counts one check as one', async () => {
		const stdout = capture();
		expect(
			await runChecks(
				[answering('only', { ok: true, detail: '' })],
				stdout,
			),
		).toBe(0);
		expect(lines(stdout.text())).toEqual(['✓ only', '1 check passed']);

		const two = capture();
		await runChecks(
			[
				answering('a', { ok: true, detail: 'ok' }),
				answering('b', { ok: true, detail: 'ok' }),
			],
			two,
		);
		expect(lines(two.text()).at(-1)).toBe('2 checks passed');

		const failing = capture();
		await runChecks(
			[answering('a', { ok: false, detail: 'no', fix: 'yes' })],
			failing,
		);
		expect(lines(failing.text()).at(-1)).toBe('1 of 1 check failed: a');
	});
});

describe('loggedCheck', () => {
	const run = (check: Check) => check.run();

	test('runs each program in turn in cwd, logs their output in order, and passes with the time taken', async () => {
		const outcome = await run(
			loggedCheck('two', {
				runs: [
					sh('echo one; echo to stderr >&2; echo three; pwd > where'),
					sh('echo two'),
				],
				cwd: dir,
				log: at('logs/two.log'),
			}),
		);
		expect(outcome.ok).toBe(true);
		expect(outcome.detail).toMatch(new RegExp(`^${SECONDS}$`));
		expect(readFileSync(at('logs/two.log'), 'utf8')).toBe(
			'one\nto stderr\nthree\ntwo\n',
		);
		expect(readFileSync(at('where'), 'utf8')).toBe(`${dir}\n`);
		expect(statSync(at('logs/two.log')).mode & 0o777).toBe(0o600);
	});

	test('stops at the first program that fails, and shows the end of the output under its exit', async () => {
		const outcome = await run(
			loggedCheck('fails', {
				runs: [
					sh('for n in 1 2 3 4 5; do echo "line $n"; done'),
					sh('echo the reason >&2; exit 3'),
					sh('echo never'),
				],
				cwd: dir,
				log: at('fails.log'),
				tail: 2,
			}),
		);
		expect(outcome).toEqual({
			ok: false,
			detail: expect.stringMatching(new RegExp(`^exit 3, ${SECONDS}$`)),
			fix: `read ${at('fails.log')}`,
			output: ['line 5', 'the reason'],
		});
		expect(readFileSync(at('fails.log'), 'utf8')).not.toContain(
			'never',
		);
	});

	test('takes the fix it is given, and shows no output for a failure that printed none', async () => {
		const outcome = await run(
			loggedCheck('quiet', {
				runs: [sh('exit 4')],
				cwd: dir,
				log: at('quiet.log'),
				fix: 'rerun it',
			}),
		);
		expect(outcome).toEqual({
			ok: false,
			detail: expect.stringMatching(/^exit 4, /),
			fix: 'rerun it',
			output: [],
		});
	});

	test('reports a program that cannot start as exit 127, its reason in the log', async () => {
		const outcome = await run(
			loggedCheck('absent', {
				runs: [['no-such-program-anywhere']],
				cwd: dir,
				log: at('absent.log'),
			}),
		);
		expect(outcome.detail).toStartWith('exit 127');
		expect(readFileSync(at('absent.log'), 'utf8')).toContain(
			'no-such-program-anywhere could not start',
		);
	});

	test('replaces the last run’s log, and never writes through a link', async () => {
		writeFileSync(at('target'), 'kept\n');
		symlinkSync(at('target'), at('linked.log'));
		const check = loggedCheck('again', {
			runs: [sh('echo fresh')],
			cwd: dir,
			log: at('linked.log'),
		});
		await run(check);
		await run(check);
		expect(readFileSync(at('linked.log'), 'utf8')).toBe('fresh\n');
		expect(readFileSync(at('target'), 'utf8')).toBe('kept\n');
	});

	test('writes an empty log for a check with nothing to run, and passes', async () => {
		const outcome = await run(
			loggedCheck('none', { runs: [], cwd: dir, log: at('none.log') }),
		);
		expect(outcome.ok).toBe(true);
		expect(existsSync(at('none.log'))).toBe(true);
	});
});
