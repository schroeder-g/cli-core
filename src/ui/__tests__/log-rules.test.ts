import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LogFollower } from '../../process/follower.ts';
import { runMarker } from '../../process/logfiles.ts';
import { LOG_RULES } from '../log-rules.ts';
import { paint } from '../paint.ts';

const ERROR_STYLE = { color: 'red', bold: true };

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cli-core-log-rules-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const texts = (segments: readonly { text: string }[]) =>
	segments.map(segment => segment.text);

describe('LOG_RULES', () => {
	test('cuts a line into plain and styled runs that join back to it', () => {
		const line =
			'2026-10-24T10:00:00.000Z info GET /health 200 in 3ms https://example.com/x ✓';
		const painted = paint(line, LOG_RULES);
		expect(texts(painted).join('')).toBe(line);
		expect(painted).toContainEqual({
			text: '2026-10-24T10:00:00.000Z',
			style: { dimColor: true },
		});
		expect(painted).toContainEqual({
			text: 'info',
			style: { color: 'cyan' },
		});
		expect(painted).toContainEqual({
			text: 'GET',
			style: { color: 'magenta' },
		});
		expect(painted).toContainEqual({
			text: '200',
			style: { color: 'green' },
		});
		expect(painted).toContainEqual({
			text: 'https://example.com/x',
			style: { color: 'cyan', underline: true },
		});
		expect(painted).toContainEqual({
			text: '✓',
			style: { color: 'green' },
		});
	});

	test('colours a status only beside an HTTP method, by its class', () => {
		expect(paint('line 404 of the file', LOG_RULES)).toEqual([
			{ text: 'line 404 of the file', style: {} },
		]);
		expect(paint('POST /x 503', LOG_RULES)).toContainEqual({
			text: '503',
			style: { color: 'red' },
		});
		expect(paint('DELETE /x 404', LOG_RULES)).toContainEqual({
			text: '404',
			style: { color: 'yellow' },
		});
	});

	test('levels take their colour whatever the case', () => {
		expect(paint('ERROR boom', LOG_RULES)[0]).toEqual({
			text: 'ERROR',
			style: ERROR_STYLE,
		});
		expect(paint('Warning: slow', LOG_RULES)[0]).toEqual({
			text: 'Warning',
			style: { color: 'yellow' },
		});
	});

	test("any program's run marker stands out whole", () => {
		const marker = runMarker('nt').line(
			'api',
			new Date('2026-10-24T10:00:00.000Z'),
		);
		expect(paint(marker, LOG_RULES)).toEqual([
			{ text: marker, style: { bold: true } },
		]);
	});

	test('paints a line as an error exactly when the follower counts it as one', () => {
		const lines = [
			'ERROR boom',
			'panic: index out of range',
			'Exception in thread main',
			'Fatal: disk full',
			'err: connection refused',
			'level=warn err=timeout',
			'GET /health 200',
			'stderr closed',
		];
		const file = join(dir, 'api.log');
		writeFileSync(file, `${lines.join('\n')}\n`);
		const logs = new LogFollower(() => [{ name: 'api', file }]);
		logs.read();
		const red = lines.filter(line =>
			paint(line, LOG_RULES).some(
				({ style }) =>
					style.color === ERROR_STYLE.color && style.bold === true,
			),
		);
		expect(red).toHaveLength(logs.snapshot().errors);
		expect(red).toEqual([
			'ERROR boom',
			'panic: index out of range',
			'Exception in thread main',
			'Fatal: disk full',
		]);
	});
});
