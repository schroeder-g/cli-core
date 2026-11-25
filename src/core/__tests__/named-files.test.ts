import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Refusal } from '../errors.ts';
import { namedFiles } from '../named-files.ts';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'cli-named-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const dumps = () =>
	namedFiles({
		dir: () => join(root, 'dumps'),
		extension: '.dump',
		noun: 'dump',
		listHint: 'nt dump list lists them',
	});

const saved = (name: string, text: string, at: Date): void => {
	mkdirSync(join(root, 'dumps'), { recursive: true });
	const file = join(root, 'dumps', `${name}.dump`);
	writeFileSync(file, text);
	utimesSync(file, at, at);
};

/** Runs a save's argv, the way a plan's step runs it. */
const run = (argv: readonly string[]): number =>
	Bun.spawnSync([...argv], { stdout: 'ignore', stderr: 'ignore' })
		.exitCode;

describe('namedFiles', () => {
	test('places a name under the directory, refusing one that is no name', () => {
		const store = dumps();
		expect(store.dir()).toBe(join(root, 'dumps'));
		expect(store.fileOf('before-v2_1')).toBe(
			join(root, 'dumps', 'before-v2_1.dump'),
		);
		for (const name of ['../x', 'Upper', '-lead', '', 'a b'])
			expect(() => store.fileOf(name)).toThrow(
				new Refusal(
					`${JSON.stringify(name)} is no dump name: lower-case letters, digits, - and _, a letter or digit first`,
				),
			);
	});

	test('lists what is saved, newest first, and nothing for no directory', () => {
		const store = dumps();
		expect(store.list()).toEqual([]);
		saved('old', 'aa', new Date('2026-01-01T00:00:00Z'));
		saved('new', 'bbbb', new Date('2026-02-01T00:00:00Z'));
		writeFileSync(join(root, 'dumps', 'notes.txt'), 'not a dump');
		expect(store.list()).toEqual([
			{
				name: 'new',
				file: join(root, 'dumps', 'new.dump'),
				bytes: 4,
				savedAt: new Date('2026-02-01T00:00:00Z'),
			},
			{
				name: 'old',
				file: join(root, 'dumps', 'old.dump'),
				bytes: 2,
				savedAt: new Date('2026-01-01T00:00:00Z'),
			},
		]);
	});

	test('refuses a name nothing is saved under, and removes one that is', () => {
		const store = dumps();
		expect(() => store.assertSaved('gone')).toThrow(
			new Refusal('no dump is named gone; nt dump list lists them'),
		);
		saved('kept', 'x', new Date());
		store.assertSaved('kept');
		store.remove('kept');
		expect(store.list()).toEqual([]);
	});

	test("saves a command's output under a name, making the directory", () => {
		const store = dumps();
		expect(run(store.saveCommand('first', ['printf', 'one']))).toBe(0);
		expect(readFileSync(store.fileOf('first'), 'utf8')).toBe('one');
		expect(run(store.saveCommand('first', ['printf', 'two']))).toBe(0);
		expect(readFileSync(store.fileOf('first'), 'utf8')).toBe('two');
	});

	test('a save that fails leaves the file it would replace, and nothing beside it', () => {
		const store = dumps();
		saved('kept', 'old', new Date());
		const failing = ['sh', '-c', 'printf partial; exit 3'];
		expect(run(store.saveCommand('kept', failing))).toBe(3);
		expect(readFileSync(store.fileOf('kept'), 'utf8')).toBe('old');
		expect(readdirSync(store.dir())).toEqual(['kept.dump']);
	});
});
