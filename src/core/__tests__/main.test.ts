import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAIN = join(import.meta.dir, '..', 'main.ts');

const MEGABYTE = 1_048_576;

/** How long an entry gets to end before the test gives up on it. */
const END_MS = 3000;

const dir = mkdtempSync(join(tmpdir(), 'cli-main-'));

let entries = 0;

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

/**
 * A program's entry script, run as its own process with two arguments:
 * `body` is the program it hands runMain.
 */
const entry = (body: string) => {
	const script = join(dir, `entry-${entries++}.ts`);
	writeFileSync(
		script,
		`import { runMain } from ${JSON.stringify(MAIN)};\nawait runMain(${body});\n`,
	);
	return Bun.spawn(['bun', script, 'one', 'two'], {
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});
};

/** The entry's exit code, or undefined once it has run too long. */
const ended = (proc: Bun.Subprocess): Promise<number | undefined> =>
	Promise.race([
		proc.exited,
		Bun.sleep(END_MS).then(() => {
			proc.kill();
			return undefined;
		}),
	]);

describe('runMain', () => {
	test('ends with the code the program answers, its arguments past the script', async () => {
		const proc = entry(
			'async argv => { console.log(JSON.stringify(argv)); return 3; }',
		);
		expect(await proc.exited).toBe(3);
		expect(await new Response(proc.stdout).text()).toBe(
			'["one","two"]\n',
		);
	});

	test('drains what the program wrote before it ends', async () => {
		const proc = entry(
			`async () => { process.stdout.write('x'.repeat(${MEGABYTE})); return 0; }`,
		);
		const [code, out] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
		]);
		expect(code).toBe(0);
		expect(out.length).toBe(MEGABYTE);
	});

	test('ends quietly, with 0, when its reader closes early', async () => {
		const proc = entry(
			`async () => {
				for (;;) {
					if (!process.stdout.write('line\\n'.repeat(1024)))
						await new Promise(resolve => process.stdout.once('drain', resolve));
				}
			}`,
		);
		const reader = proc.stdout.getReader();
		await reader.read();
		await reader.cancel();
		expect(await ended(proc)).toBe(0);
		expect(await new Response(proc.stderr).text()).toBe('');
	});
});
