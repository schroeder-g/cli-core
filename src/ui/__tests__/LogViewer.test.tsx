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
import { stripVTControlCharacters } from 'node:util';

import { LogFollower } from '../../process/follower.ts';
import { drive, matching, open, shown } from '../../testing/index.ts';
import type { Step } from '../../testing/index.ts';
import type { LogViewerProps } from '../LogViewer.tsx';
import { presentView } from '../screen.ts';

const ENTER = '\r';

const TITLE = 'nt logs  every run';

/** Where Ink begins and ends each frame it writes. */
const FRAME_START = '\u001b[?2026h';

const FRAME_END = '\u001b[?2026l';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cli-core-log-viewer-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Every frame written, each as the lines the terminal shows. */
const framesOf = (raw: string): string[][] =>
	raw
		.split(FRAME_START)
		.slice(1)
		.map(frame =>
			stripVTControlCharacters(frame.split(FRAME_END)[0] ?? '').split(
				'\n',
			),
		);

/** The last frame on `now`, the screen so far. */
const lastFrame = (now: string): string =>
	now.slice(now.lastIndexOf(TITLE));

/**
 * Whether a frame with the help open has settled: its stream holds the
 * lines its foot says it shows.
 */
function settled(frame: string): boolean {
	const lines = frame.split('\n');
	const [, from, to] = /showing (\d+)-(\d+) of/.exec(frame) ?? [];
	return (
		frame.includes('keys · ? or q closes')
		&& from !== undefined
		&& lines.filter(line => / line \d+$/.test(line)).length
			=== Number(to) - Number(from) + 1
	);
}

/** Once the last frame has settled with the help open. */
const helpSettled = (key: string): Step => ({
	label: 'the help open and the stream settled',
	until: now => settled(lastFrame(now)),
	key,
});

/** A follower over an api and a web log, read once. */
function follower(api: readonly string[], web: readonly string[]) {
	const files = {
		api: join(dir, 'api.log'),
		web: join(dir, 'web.log'),
	};
	writeFileSync(files.api, api.map(line => `${line}\n`).join(''));
	writeFileSync(files.web, web.map(line => `${line}\n`).join(''));
	const logs = new LogFollower(() => [
		{ name: 'api', file: files.api },
		{ name: 'web', file: files.web },
	]);
	logs.read();
	return { logs, files };
}

/** Drives the viewer on a terminal `rows` high through `steps`. */
const view = (
	logs: LogFollower,
	steps: readonly Step[],
	rows = 24,
	props: Partial<LogViewerProps> = {},
) =>
	drive(
		open((input, out) => {
			Object.assign(out, { rows });
			return presentView<'back', LogViewerProps>(
				{ stdin: input, stdout: out, stderr: out },
				'the logs need a terminal',
				() => import('../LogViewer.tsx'),
				'LogViewer',
				exit => ({
					logs,
					title: 'nt logs',
					sub: 'every run',
					onBack: () => exit.done('back'),
					...props,
				}),
				{ from: 'the list' },
			);
		}),
		steps,
	);

describe('LogViewer', () => {
	test("shows every source's lines under its name, filtered by name and pattern, and q goes back", async () => {
		const { logs } = follower(
			['listening on 9000', 'GET /health 200'],
			['ready', 'GET /Health 200'],
		);
		const driven = await view(logs, [
			shown('showing 1-4 of 4', '2'),
			shown('showing 1-2 of 2 · following · 2 filtered out', 'a'),
			matching(/showing 1-4 of 4(?![\s\S]*filtered)[\s\S]*$/, '/'),
			shown('/ ▏', 'health'),
			shown('health▏', ENTER),
			matching(/\/ health[\s\S]*showing 1-2 of 2[^\n]*$/m, 'c'),
			matching(
				/no pattern[\s\S]*showing 1-4 of 4[^\n]*following$/m,
				'q',
			),
		]);
		expect(driven.result).toBe('back');
		expect(driven.screen).toContain('nt logs  every run');
		expect(driven.screen).toContain('1 api · 2 web');
		expect(driven.screen).toMatch(/api {2}listening on 9000/);
		expect(driven.screen).toMatch(/web {2}ready/);
		expect(driven.screen).toContain('q back to the');
		expect(driven.screen).toContain('1-9 toggles that log');
	});

	test('names its sources by the noun it is given', async () => {
		const { logs } = follower(['up'], []);
		const driven = await view(
			logs,
			[
				shown('showing 1-1 of 1', '?'),
				shown('keys · ? or q closes', 'q'),
				shown('all keys', 'q'),
			],
			40,
			{ noun: 'unit' },
		);
		expect(driven.screen).toContain('1-9 toggles that unit');
		expect(driven.screen).toContain("hides or shows that unit's lines");
		expect(driven.screen).toContain('shows every unit');
	});

	test('goes back on Escape, and on the key it is given besides q', async () => {
		const { logs } = follower(['up'], []);
		const plain = await view(logs, [
			shown('showing 1-1 of 1', 'f'),
			shown('showing 1-1 of 1', '?'),
			shown('keys · ? or q closes', 'q'),
			matching(/all keys(?![\s\S]*closes)/, '\u001b'),
		]);
		expect(plain.result).toBe('back');
		const given = await view(
			logs,
			[shown('showing 1-1 of 1', 'f')],
			24,
			{ backKey: 'f' },
		);
		expect(given.result).toBe('back');
	});

	test('follows the newest line, and stops following once scrolled back', async () => {
		const { logs, files } = follower(
			Array.from({ length: 30 }, (_, at) => `line ${at}`),
			[],
		);
		const driven = await view(logs, [
			shown('line 29', 'k'),
			matching(
				/showing \d+-29 of 30(?! · following)[^\n]*$/m,
				'',
				undefined,
				() => {
					appendFileSync(files.api, 'line 30\n');
					logs.read();
				},
			),
			matching(/showing \d+-30 of 31(?! · following)[^\n]*$/m, 'G'),
			matching(
				/line 30[\s\S]*showing \d+-31 of 31 · following[^\n]*$/m,
				'q',
			),
		]);
		expect(driven.result).toBe('back');
	});

	for (const [rows, each] of [
		[24, 60],
		[30, 60],
		[24, 5],
	] as const)
		test(`a terminal ${rows} rows high holds every frame of ${each * 2} lines, the help open or not, a pattern's problem shown or not`, async () => {
			const { logs } = follower(
				Array.from({ length: each }, (_, at) => `api line ${at}`),
				Array.from({ length: each }, (_, at) => `web line ${at}`),
			);
			const newest = `web line ${each - 1}`;
			const driven = await view(
				logs,
				[
					shown(newest, '?'),
					helpSettled('?'),
					matching(/all keys/, '/', lastFrame),
					shown('/ ▏', '('),
					shown('(▏', ENTER),
					shown('pattern: ', '?'),
					helpSettled('q'),
					matching(/pattern: [\s\S]*all keys/, 'q', lastFrame),
				],
				rows,
			);
			expect(driven.result).toBe('back');
			const frames = framesOf(driven.raw);
			for (const frame of frames) {
				expect(frame.length).toBeLessThanOrEqual(rows);
				expect(frame[0]).toBe(TITLE);
				expect(
					frame.findLast(line => / line \d+$/.test(line)),
				).toEndWith(newest);
			}
			const helped = frames.filter(frame => settled(frame.join('\n')));
			expect(helped.length).toBeGreaterThan(1);
			for (const frame of helped) {
				expect(frame).toHaveLength(rows);
				expect(frame.at(-1)).toStartWith('╰');
				expect(
					frame.findLast(line => / line \d+$/.test(line)),
				).toEndWith(newest);
			}
		});

	test('a terminal too short for the help keeps its title and cuts the help', async () => {
		const { logs } = follower(
			Array.from({ length: 30 }, (_, at) => `api line ${at}`),
			[],
		);
		const driven = await view(
			logs,
			[
				shown('api line 29', '?'),
				shown('keys · ? or q closes', 'q'),
				matching(/all keys/, 'q', lastFrame),
			],
			12,
		);
		expect(driven.result).toBe('back');
		for (const frame of framesOf(driven.raw)) {
			expect(frame.length).toBeLessThanOrEqual(12);
			expect(frame[0]).toBe(TITLE);
		}
	});
});
