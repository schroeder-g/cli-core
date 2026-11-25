import { LOG_ERROR } from '../process/follower.ts';
import { RUN_MARKER_LINE } from '../process/logfiles.ts';
import type { Rule } from './paint.ts';

const HTTP_METHOD = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;

const STATUS_COLORS: Readonly<Record<string, string>> = {
	1: 'cyan',
	2: 'green',
	3: 'cyan',
	4: 'yellow',
	5: 'red',
};

/**
 * How a log line is coloured: a run marker stands out, timestamps
 * recede, levels take their colour, the error words `LOG_ERROR` counts
 * among them, HTTP methods and the status beside them stand out, urls
 * are underlined, and a check or a cross keeps its tone.
 */
export const LOG_RULES: readonly Rule[] = [
	{ pattern: RUN_MARKER_LINE, style: { bold: true } },
	{
		pattern:
			/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b|\b\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\b/g,
		style: { dimColor: true },
	},
	{ pattern: LOG_ERROR, style: { color: 'red', bold: true } },
	{ pattern: /\b(?:warn|warning)\b/gi, style: { color: 'yellow' } },
	{ pattern: /\binfo\b/gi, style: { color: 'cyan' } },
	{ pattern: /\b(?:debug|trace)\b/gi, style: { dimColor: true } },
	{
		pattern: new RegExp(HTTP_METHOD.source, 'g'),
		style: { color: 'magenta' },
	},
	{
		when: HTTP_METHOD,
		pattern: /\b([1-5])\d{2}\b/g,
		style: match => ({ color: STATUS_COLORS[match[1] ?? ''] }),
	},
	{
		pattern: /https?:\/\/[^\s'"<>]+/g,
		style: { color: 'cyan', underline: true },
	},
	{ pattern: /✓/g, style: { color: 'green' } },
	{ pattern: /✗/g, style: { color: 'red' } },
];
