import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import {
	appendFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	beginRun,
	cleanLine,
	lastRunOffset,
	linesSince,
	rotatedPath,
	runMarker,
	tailOf,
} from '../logfiles.ts';

const MARKER = runMarker('nt');

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cli-core-logfiles-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const AT = (minute: number) =>
	new Date(`2026-10-24T10:${String(minute).padStart(2, '0')}:00.000Z`);

describe('runMarker', () => {
	test('a marker line names the program, the run and when it began, and reads back to that time', () => {
		const line = MARKER.line('api', AT(5));
		expect(line).toBe('▶ nt started api at 2026-10-24T10:05:00.000Z');
		expect(MARKER.pattern.exec(line)?.slice(1)).toEqual([
			'api',
			'2026-10-24T10:05:00.000Z',
		]);
		expect(MARKER.timeOf(line)).toEqual(AT(5));
		expect(MARKER.timeOf('listening on 9000')).toBeUndefined();
		expect(MARKER.timeOf('▶ nt started api at noon')).toBeUndefined();
	});

	test("another program's marker is not this one's", () => {
		const other = runMarker('n.t');
		expect(other.timeOf(MARKER.line('api', AT(0)))).toBeUndefined();
		expect(MARKER.timeOf(other.line('api', AT(0)))).toBeUndefined();
		expect(
			other.timeOf('▶ nxt started api at 2026-10-24T10:00:00.000Z'),
		).toBeUndefined();
	});
});

describe('beginRun', () => {
	test('opens each run with a marker, appended after the runs before it, the file private', () => {
		const file = join(dir, 'logs', 'api.log');
		beginRun(file, 'api', MARKER, { now: AT(0) });
		appendFileSync(file, 'first run\n');
		beginRun(file, 'api', MARKER, { now: AT(5) });
		expect(readFileSync(file, 'utf8')).toBe(
			`${MARKER.line('api', AT(0))}\nfirst run\n${MARKER.line('api', AT(5))}\n`,
		);
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	test('moves a log past its cap aside as its one previous generation', () => {
		const file = join(dir, 'api.log');
		writeFileSync(rotatedPath(file), 'the oldest\n');
		writeFileSync(file, 'a run that grew past the cap\n');
		beginRun(file, 'api', MARKER, { now: AT(1), cap: 10 });
		expect(readFileSync(rotatedPath(file), 'utf8')).toBe(
			'a run that grew past the cap\n',
		);
		expect(readFileSync(file, 'utf8')).toBe(
			`${MARKER.line('api', AT(1))}\n`,
		);
		beginRun(file, 'api', MARKER, { now: AT(2), cap: 1000 });
		expect(existsSync(rotatedPath(file))).toBe(true);
		expect(
			readFileSync(file, 'utf8').split('\n').filter(Boolean),
		).toHaveLength(2);
	});
});

describe('lastRunOffset', () => {
	test("finds the last run's marker, at the start or after earlier runs, and nothing without one", () => {
		const file = join(dir, 'api.log');
		expect(lastRunOffset(file, MARKER)).toBeUndefined();
		writeFileSync(file, 'no marker here\n');
		expect(lastRunOffset(file, MARKER)).toBeUndefined();
		writeFileSync(file, `${MARKER.line('api', AT(0))}\nfirst\n`);
		expect(lastRunOffset(file, MARKER)).toBe(0);
		const before = `${MARKER.line('api', AT(0))}\nfirst ✓\n`;
		writeFileSync(
			file,
			`${before}${MARKER.line('api', AT(3))}\nsecond\n`,
		);
		expect(lastRunOffset(file, MARKER)).toBe(Buffer.byteLength(before));
	});
});

describe('linesSince', () => {
	test('every run begun at or after the time, the rotated generation read first', () => {
		const file = join(dir, 'api.log');
		writeFileSync(
			rotatedPath(file),
			`${MARKER.line('api', AT(0))}\nold\n${MARKER.line('api', AT(10))}\nten\n`,
		);
		writeFileSync(
			file,
			`${MARKER.line('api', AT(20))}\n\u001b[32mtwenty\u001b[39m\r\n`,
		);
		expect(linesSince(file, AT(5), MARKER)).toEqual([
			MARKER.line('api', AT(10)),
			'ten',
			MARKER.line('api', AT(20)),
			'twenty',
		]);
		expect(linesSince(file, AT(20), MARKER)).toEqual([
			MARKER.line('api', AT(20)),
			'twenty',
		]);
		expect(linesSince(file, AT(30), MARKER)).toEqual([]);
		expect(linesSince(join(dir, 'none.log'), AT(0), MARKER)).toEqual(
			[],
		);
	});
});

describe('tailOf', () => {
	test('the last lines, cleaned, whether they sit in the first window read or far behind it', () => {
		const file = join(dir, 'api.log');
		expect(tailOf(file, 3)).toEqual([]);
		const filler = 'x'.repeat(199);
		const lines = Array.from(
			{ length: 2000 },
			(_, at) => `${at} ${filler}`,
		);
		writeFileSync(
			file,
			`\u001b[31mfirst\u001b[39m\r\n${lines.join('\n')}\nlast\n`,
		);
		expect(tailOf(file, 2)).toEqual([`1999 ${filler}`, 'last']);
		const all = tailOf(file, 5000);
		expect(all).toHaveLength(2002);
		expect(all[0]).toBe('first');
		expect(all[1000]).toBe(`999 ${filler}`);
		expect(tailOf(file, 0)).toEqual([]);
	});
});

describe('cleanLine', () => {
	test("strips a line's colours, links and cursor moves, and the carriage return before its end", () => {
		expect(cleanLine('\u001b[31mred\u001b[39m\r')).toBe('red');
		expect(
			cleanLine(
				'\u001b]8;;https://a.com/x?y=1\u0007link\u001b]8;;\u0007',
			),
		).toBe('link');
		expect(cleanLine('\u001b[2K\u001b[1Gprogress')).toBe('progress');
		expect(cleanLine('a\rb')).toBe('a\rb');
	});
});
