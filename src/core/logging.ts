import {
	configure,
	getLogger,
	getTextFormatter,
} from '@logtape/logtape';
import type { LogLevel, LogRecord, Sink } from '@logtape/logtape';

import { lineWriter } from './streams.ts';
import { visibleText } from './text.ts';

const CATEGORY = 'cli';

const META_CATEGORY = ['logtape', 'meta'];

export type { Logger, LogLevel } from '@logtape/logtape';

export const log = getLogger(CATEGORY);

const format = getTextFormatter({
	timestamp: 'none',
	level: 'full',
	value: 'bare',
	format: ({ level, message }) => `${level}: ${message}`,
});

const line = (record: LogRecord): string =>
	// A message carrying a path or a child's output cannot drive the
	// terminal: every control character but a newline or a tab is text.
	visibleText(format(record).trimEnd(), ['\n', '\t']);

/**
 * Routes the program's log to `write`, one line per record, from
 * `level` up.
 */
export async function configureLogging(
	level: LogLevel,
	write: (text: string) => void = lineWriter(process.stderr),
): Promise<void> {
	const stderr: Sink = record => {
		write(line(record));
	};

	await configure({
		reset: true,
		sinks: { stderr },
		loggers: [
			{ category: CATEGORY, lowestLevel: level, sinks: ['stderr'] },
			{
				category: META_CATEGORY,
				lowestLevel: 'warning',
				sinks: ['stderr'],
			},
		],
	});
}
