import { beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { Failure } from '../../core/errors.ts';
import { configureLogging } from '../../core/logging.ts';
import { formatCapture } from '../../core/plan.ts';
import type { Secret } from '../../core/plan.ts';
import { capture, captureOrFail, SpawnFailure } from '../spawn.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');

const SECRET_VALUE = 'hunter2';

const SECRET_REF = 'op://vault/item/token';

const PRINT_TOKEN = [
	'bun',
	'-e',
	'console.log(process.env.TOKEN + " " + process.argv[1])',
];

let lines: string[] = [];

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

const failing = (stderr: string, code = 3): string[] => [
	'bun',
	'-e',
	`console.error(${JSON.stringify(stderr)}); process.exit(${code})`,
];

beforeEach(async () => {
	lines = [];
	await configureLogging('debug', line => {
		lines.push(line);
	});
});

describe('capture', () => {
	test('resolves each secret of argv and env once, at the spawn', async () => {
		const token = secret();
		const result = await capture([...PRINT_TOKEN, token], {
			env: { TOKEN: token },
		});
		expect(result.stdout).toBe('hunter2 hunter2\n');
		expect(token.reads()).toBe(1);
	});

	test('refuses a value holding a NUL byte by its name, never its text', async () => {
		const cases = [
			capture(['bun', '-e', ''], { env: { TOKEN: 'hunter2\0tail' } }),
			capture(['bun', '-e', '', secret('hunter2\0tail')]),
		];
		const names = ['TOKEN', 'argument 4'];
		for (const [i, refused] of cases.entries()) {
			const error: unknown = await refused.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(Failure);
			expect(error).not.toBeInstanceOf(SpawnFailure);
			expect((error as Error).message).toBe(
				`${names[i]} holds a NUL byte, which bun cannot pass on`,
			);
			expect((error as Error).message).not.toContain(SECRET_VALUE);
		}
	});

	test('runs a relative cwd under root', async () => {
		const result = await capture(['pwd'], { root: ROOT, cwd: 'src' });
		expect(result.stdout.trim()).toEndWith('/src');
	});
});

describe('captureOrFail', () => {
	test("answers the program's stdout as it printed it", async () => {
		expect(
			await captureOrFail(['bun', '-e', 'console.log(" out ")']),
		).toBe(' out \n');
	});

	test('fails naming the command, its directory and the cause', async () => {
		const token = secret();
		await expect(
			captureOrFail([...failing('  boom\n'), token, 'two words'], {
				root: ROOT,
				cwd: 'src',
			}),
		).rejects.toThrow(
			new Failure(
				`bun -e 'console.error("  boom\\n"); process.exit(3)' <${SECRET_REF}> 'two words' failed in src: boom`,
			),
		);
		await expect(captureOrFail(failing(''))).rejects.toThrow(
			/failed: exit 3$/,
		);
		await expect(
			captureOrFail(failing('a\nb'), {
				cause: (stderr, code) => `${stderr.split('\n')[0]} (${code})`,
			}),
		).rejects.toThrow(/failed: a \(3\)$/);
	});

	test('answers nothing when stderr says the thing read is absent', async () => {
		const absent = /no such thing/;
		expect(
			await captureOrFail(failing('ERROR: no such thing'), { absent }),
		).toBeUndefined();
		expect(
			lines.filter(line => line.includes('found nothing')),
		).toEqual([
			expect.stringContaining('found nothing: ERROR: no such thing'),
		]);
		await expect(
			captureOrFail(failing('ERROR: denied'), { absent }),
		).rejects.toThrow(/failed: ERROR: denied$/);
	});
});

describe('formatCapture', () => {
	test('prints the directory, the command and the variables by reference', () => {
		expect(
			formatCapture(['git', 'log', '--format', '%H %s'], {
				root: ROOT,
				cwd: 'src',
				env: { TOKEN: secret(), PLAIN: 'shown' },
			}),
		).toBe(
			`in src: git log --format '%H %s'  env: TOKEN ← ${SECRET_REF}, PLAIN`,
		);
		expect(
			formatCapture(['git', 'status'], { root: ROOT, cwd: ROOT }),
		).toBe('in .: git status');
	});
});
