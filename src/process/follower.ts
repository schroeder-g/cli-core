import { messageOf } from '../core/errors.ts';
import { ExternalStore } from '../core/store.ts';
import {
	cleanLine,
	lastRunOffset,
	readRange,
	sizeOf,
} from './logfiles.ts';
import type { RunMarker } from './logfiles.ts';

const FOLLOW_MS = 250;

const KEEP = 5000;

/**
 * What makes a log line an error: a level word. `err` is left out, as
 * it names a field (`err=…`) more often than a level.
 */
export const LOG_ERROR = /\b(?:error|fatal|panic|exception)\b/i;

/** A file the follower reads and the name its lines go under. */
export interface LogSource {
	readonly name: string;
	readonly file: string;
}

export interface LogLine {
	/** Its place in arrival order, unique across sources. */
	readonly seq: number;
	/** The name of the source it came from. */
	readonly name: string;
	readonly text: string;
}

/** What a log view reads: every line kept, and the filter over them. */
export interface LogsSnapshot {
	readonly lines: readonly LogLine[];
	/** The kept lines the filter leaves in, in arrival order. */
	readonly visible: readonly LogLine[];
	/** How many kept lines `LOG_ERROR` matches. */
	readonly errors: number;
	/** The sources' names, in the order the sources were given. */
	readonly names: readonly string[];
	/** The names whose lines the filter leaves out. */
	readonly hidden: ReadonlySet<string>;
	/** The pattern typed, as typed. */
	readonly pattern: string;
	/** The pattern compiled, case-insensitive; none for an empty pattern. */
	readonly regex: RegExp | undefined;
	/** Why the pattern does not compile, or nothing. */
	readonly problem: string | undefined;
}

export interface LogFollowerOptions {
	/** How many lines are kept, the oldest dropped first; 5000 by default. */
	readonly keep?: number;
	/** How often `follow` reads the files; every 250 ms by default. */
	readonly intervalMs?: number;
	/**
	 * The marker the logs' runs open with, which `follow` starts a run
	 * at.
	 */
	readonly marker?: RunMarker;
}

interface Position {
	offset: number;
	/** The bytes of a line not yet ended by a newline. */
	partial: string;
}

/**
 * A pattern compiled, case-insensitive, or why it does not compile;
 * none for an empty one.
 */
export const compilePattern = (
	pattern: string,
): Pick<LogsSnapshot, 'regex' | 'problem'> => {
	if (pattern === '') return { regex: undefined, problem: undefined };
	try {
		return { regex: new RegExp(pattern, 'i'), problem: undefined };
	} catch (error) {
		return { regex: undefined, problem: messageOf(error) };
	}
};

const filtered = (
	lines: readonly LogLine[],
	{ hidden, regex }: Pick<LogsSnapshot, 'hidden' | 'regex'>,
): LogLine[] =>
	lines.filter(
		line =>
			!hidden.has(line.name)
			&& (regex === undefined || regex.test(line.text)),
	);

const errorsIn = (lines: readonly LogLine[]): number =>
	lines.filter(line => LOG_ERROR.test(line.text)).length;

/**
 * Several log files as one stream: each source's file is read from
 * where it was last read, its new lines stripped of escapes and kept in
 * arrival order behind every other source's, the oldest dropped past
 * `keep`. A file that appears after the following begins is read
 * whole, and one that shrinks is read again from its start. A name can
 * be hidden and a pattern set; the lines the filter leaves in and the
 * error count follow each batch, recounted whole only when the filter
 * changes. `sources` is asked again on each read, so the set can grow.
 */
export class LogFollower extends ExternalStore<LogsSnapshot> {
	readonly #sources: () => readonly LogSource[];

	readonly #keep: number;

	readonly #intervalMs: number;

	readonly #marker: RunMarker | undefined;

	readonly #positions = new Map<string, Position>();

	#seq = 0;

	readonly #lineListeners = new Set<
		(lines: readonly LogLine[]) => void
	>();

	#timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		sources: () => readonly LogSource[],
		{
			keep = KEEP,
			intervalMs = FOLLOW_MS,
			marker,
		}: LogFollowerOptions = {},
	) {
		super({
			lines: [],
			visible: [],
			errors: 0,
			names: [],
			hidden: new Set(),
			pattern: '',
			regex: undefined,
			problem: undefined,
		});
		this.#sources = sources;
		this.#keep = keep;
		this.#intervalMs = intervalMs;
		this.#marker = marker;
	}

	/**
	 * Reads now, then on the interval until `close`. A file there already
	 * is read from its end, or, given a marker, from its last run's
	 * marker for a source `fromRun` names, so a run that began before the
	 * following shows whole.
	 */
	follow(fromRun: (name: string) => boolean = () => false): void {
		const marker = this.#marker;
		for (const { name, file } of this.#sources())
			if (!this.#positions.has(file))
				this.#positions.set(file, {
					offset:
						(marker !== undefined && fromRun(name)
							? lastRunOffset(file, marker)
							: undefined)
						?? sizeOf(file)
						?? 0,
					partial: '',
				});
		this.read();
		this.#timer ??= setInterval(() => this.read(), this.#intervalMs);
	}

	close(): void {
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	/** Reads every source's new lines; a file not there yet has none. */
	read(): void {
		const seen = new Set<string>();
		const names: string[] = [];
		const fresh: LogLine[] = [];
		for (const { name, file } of this.#sources()) {
			if (seen.has(file)) continue;
			seen.add(file);
			if (!names.includes(name)) names.push(name);
			for (const text of this.#newLines(file))
				fresh.push({ seq: this.#seq++, name, text });
		}
		const grown = fresh.length > 0;
		if (grown)
			for (const listener of this.#lineListeners) listener(fresh);
		const before = this.snapshot();
		const sameNames =
			names.length === before.names.length
			&& names.every((name, at) => name === before.names[at]);
		if (!grown && sameNames) return;
		const all = [...before.lines, ...fresh];
		const dropped = all.slice(0, Math.max(0, all.length - this.#keep));
		const lines =
			dropped.length === 0 ? all : all.slice(dropped.length);
		const firstKept = lines[0]?.seq ?? this.#seq;
		const visible = [...before.visible, ...filtered(fresh, before)];
		let cut = 0;
		while ((visible[cut]?.seq ?? firstKept) < firstKept) cut++;
		this.publish({
			...before,
			lines,
			visible: cut === 0 ? visible : visible.slice(cut),
			errors: before.errors + errorsIn(fresh) - errorsIn(dropped),
			names: sameNames ? before.names : names,
		});
	}

	/**
	 * Tells `listener` each batch of new lines as it is read, every line
	 * whatever the store keeps; answers the way to stop.
	 */
	onLines(listener: (lines: readonly LogLine[]) => void): () => void {
		this.#lineListeners.add(listener);
		return () => {
			this.#lineListeners.delete(listener);
		};
	}

	/** Hides the lines of `name`, or shows them again. */
	toggle(name: string): void {
		const hidden = new Set(this.snapshot().hidden);
		if (!hidden.delete(name)) hidden.add(name);
		this.#refilter({ hidden });
	}

	showAll(): void {
		this.#refilter({ hidden: new Set() });
	}

	setPattern(pattern: string): void {
		this.#refilter({ pattern, ...compilePattern(pattern) });
	}

	#refilter(
		filter: Partial<
			Pick<LogsSnapshot, 'hidden' | 'pattern' | 'regex' | 'problem'>
		>,
	): void {
		const next = { ...this.snapshot(), ...filter };
		this.publish({ ...next, visible: filtered(next.lines, next) });
	}

	/** The lines `file` gained since it was last read, whole lines only. */
	#newLines(file: string): string[] {
		const size = sizeOf(file);
		if (size === undefined) return [];
		let position = this.#positions.get(file);
		if (position === undefined) {
			position = { offset: 0, partial: '' };
			this.#positions.set(file, position);
		}
		if (size < position.offset) {
			position.offset = 0;
			position.partial = '';
		}
		if (size === position.offset) return [];
		const chunk = readRange(file, position.offset, size);
		position.offset = size;
		const pieces = (position.partial + chunk.toString('utf8')).split(
			'\n',
		);
		position.partial = pieces.pop() ?? '';
		return pieces.map(cleanLine);
	}
}
