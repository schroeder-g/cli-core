import { describe, expect, test } from 'bun:test';

import { highlight, paint } from '../paint.ts';

const METHOD = [{ pattern: /GET/g, style: { color: 'magenta' } }];

const texts = (segments: readonly { text: string }[]) =>
	segments.map(segment => segment.text);

describe('paint', () => {
	test('nothing paints an empty line', () => {
		expect(paint('', METHOD)).toEqual([]);
	});

	test('the earlier start wins an overlap, then the earlier rule', () => {
		const painted = paint('error: warn', [
			{ pattern: /error: warn/g, style: { color: 'red' } },
			{ pattern: /warn/g, style: { color: 'yellow' } },
		]);
		expect(painted).toEqual([
			{ text: 'error: warn', style: { color: 'red' } },
		]);
		const ranked = paint('warn', [
			{ pattern: /warn/g, style: { color: 'red' } },
			{ pattern: /wa/g, style: { color: 'yellow' } },
		]);
		expect(ranked).toEqual([{ text: 'warn', style: { color: 'red' } }]);
	});
});

describe('highlight', () => {
	test('inverts every match over the style it sits in, and leaves the rest', () => {
		const painted = paint('GET /health 200', METHOD);
		const lit = highlight(painted, /heal/i);
		expect(texts(lit).join('')).toBe('GET /health 200');
		expect(lit).toContainEqual({
			text: 'heal',
			style: { inverse: true },
		});
		expect(lit).toContainEqual({
			text: 'GET',
			style: { color: 'magenta' },
		});
		const inside = highlight(
			[{ text: 'GET', style: { color: 'magenta' } }],
			/E/,
		);
		expect(inside).toEqual([
			{ text: 'G', style: { color: 'magenta' } },
			{ text: 'E', style: { color: 'magenta', inverse: true } },
			{ text: 'T', style: { color: 'magenta' } },
		]);
	});

	test('without a pattern the segments pass through', () => {
		const painted = paint('plain', METHOD);
		expect(highlight(painted, undefined)).toEqual(painted);
	});
});
