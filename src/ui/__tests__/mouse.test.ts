import { describe, expect, test } from 'bun:test';

import { isLeftPress, splitReports, wheelOf } from '../mouse.ts';

describe('splitReports', () => {
	test('cuts every SGR report out of the input and keeps the keys', () => {
		const { reports, rest } = splitReports(
			'j\u001b[<0;12;7M\u001b[<0;12;7mq\u001b[<65;1;1M',
		);
		expect(rest).toBe('jq');
		expect(reports).toEqual([
			{ button: 0, x: 12, y: 7, released: false },
			{ button: 0, x: 12, y: 7, released: true },
			{ button: 65, x: 1, y: 1, released: false },
		]);
		expect(reports.map(isLeftPress)).toEqual([true, false, false]);
		expect(reports.map(wheelOf)).toEqual([undefined, undefined, 1]);
		expect(wheelOf({ button: 64, x: 1, y: 1, released: false })).toBe(
			-1,
		);
	});

	test('leaves input without a report as it is', () => {
		expect(splitReports('health\r')).toEqual({
			reports: [],
			rest: 'health\r',
		});
	});
});
