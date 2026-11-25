import {
	closeSync,
	constants as fs,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	statSync,
	writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { LOG_MODE, LOG_OPEN_FLAGS } from './spawn.ts';

/** How large a log may grow across runs before a run rotates it. */
const LOG_CAP_BYTES = 10 * 1024 * 1024;

/** How far back from a log's end its last run is looked for. */
const SCAN_BYTES = 1024 * 1024;

/**
 * How much of a log's end a tail reads first, doubling until it has
 * enough.
 */
const TAIL_WINDOW_BYTES = 64 * 1024;

/**
 * The line a program writes into a log before each run's output,
 * `▶ <program> started <name> at <ISO time>`, so a reader finds where
 * each run began.
 */
export interface RunMarker {
	/** What every marker line begins with. */
	readonly prefix: string;
	/** Matches a whole marker line: the run's name, then its time. */
	readonly pattern: RegExp;
	readonly line: (name: string, at: Date) => string;
	/** When the run a marker line opens began; nothing for any other line. */
	readonly timeOf: (line: string) => Date | undefined;
}

/** Matches any program's run marker line, whole. */
export const RUN_MARKER_LINE = /^▶ \S+ started \S+ at \S+$/;

export interface BeginRunOptions {
	readonly now?: Date;
	/** The size past which the log moves aside first; 10 MiB by default. */
	readonly cap?: number;
}

/** The run marker `program` writes. */
export function runMarker(program: string): RunMarker {
	const prefix = `▶ ${program} started `;
	const pattern = new RegExp(
		`^${RegExp.escape(prefix)}(\\S+) at (\\S+)$`,
	);
	return {
		prefix,
		pattern,
		line: (name, at) => `${prefix}${name} at ${at.toISOString()}`,
		timeOf: line => {
			const found = pattern.exec(line);
			if (found === null) return undefined;
			const at = new Date(found[2] ?? '');
			return Number.isNaN(at.getTime()) ? undefined : at;
		},
	};
}

/**
 * A line of a child's output as a program prints it again: its terminal
 * escapes and a carriage return before its end stripped.
 */
export const cleanLine = (line: string): string =>
	stripVTControlCharacters(line).replace(/\r$/, '');

/** The previous generation a rotation keeps beside a log. */
export const rotatedPath = (file: string): string => `${file}.1`;

/** A file's size in bytes; none while it does not exist. */
export const sizeOf = (file: string): number | undefined => {
	try {
		return statSync(file).size;
	} catch {
		return undefined;
	}
};

/** The bytes of `file` from `from` up to `to`. */
export function readRange(
	file: string,
	from: number,
	to: number,
): Buffer {
	const chunk = Buffer.alloc(to - from);
	const fd = openSync(file, fs.O_RDONLY);
	try {
		readSync(fd, chunk, 0, chunk.length, from);
	} finally {
		closeSync(fd);
	}
	return chunk;
}

/**
 * Opens a run named `name` in its log: a log past the cap moves aside
 * as its one previous generation, replacing the one before, and the
 * marker line goes in, so the run's output follows it.
 */
export function beginRun(
	file: string,
	name: string,
	marker: RunMarker,
	{ now = new Date(), cap = LOG_CAP_BYTES }: BeginRunOptions = {},
): void {
	mkdirSync(dirname(file), { recursive: true });
	if ((sizeOf(file) ?? 0) > cap) renameSync(file, rotatedPath(file));
	const fd = openSync(file, LOG_OPEN_FLAGS, LOG_MODE);
	try {
		writeSync(fd, `${marker.line(name, now)}\n`);
	} finally {
		closeSync(fd);
	}
}

/**
 * The byte offset of the last run's marker line in `file`, looked for
 * in its last megabyte; nothing when there is none there.
 */
export function lastRunOffset(
	file: string,
	marker: RunMarker,
): number | undefined {
	const size = sizeOf(file);
	if (size === undefined || size === 0) return undefined;
	const from = Math.max(0, size - SCAN_BYTES);
	const text = readRange(file, from, size).toString('utf8');
	const at = text.lastIndexOf(`\n${marker.prefix}`);
	if (at !== -1) return from + Buffer.byteLength(text.slice(0, at + 1));
	return from === 0 && text.startsWith(marker.prefix) ? 0 : undefined;
}

const linesOf = (file: string): string[] => {
	try {
		const lines = readFileSync(file, 'utf8').split('\n');
		if (lines.at(-1) === '') lines.pop();
		return lines;
	} catch {
		return [];
	}
};

/**
 * Every line of the runs that began at or after `since`, from the
 * rotated generation and the log alike, each run from its marker on,
 * cleaned.
 */
export function linesSince(
	file: string,
	since: Date,
	marker: RunMarker,
): string[] {
	const lines = [...linesOf(rotatedPath(file)), ...linesOf(file)];
	const first = lines.findIndex(line => {
		const at = marker.timeOf(line);
		return at !== undefined && at >= since;
	});
	return first === -1 ? [] : lines.slice(first).map(cleanLine);
}

/**
 * The last `count` lines of `file`, cleaned; none when it cannot be
 * read yet. Reads back from the end only as far as the lines need.
 */
export function tailOf(file: string, count: number): string[] {
	const size = sizeOf(file);
	if (size === undefined || count === 0) return [];
	let window = TAIL_WINDOW_BYTES;
	for (;;) {
		const from = Math.max(0, size - window);
		const lines = readRange(file, from, size)
			.toString('utf8')
			.split('\n');
		if (lines.at(-1) === '') lines.pop();
		// A window that starts mid-file starts mid-line; that line waits for
		// a wider window.
		if (from > 0) lines.shift();
		if (lines.length >= count || from === 0)
			return lines.slice(-count).map(cleanLine);
		window *= 2;
	}
}
