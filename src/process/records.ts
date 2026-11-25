import {
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { z } from 'zod';

import { Failure } from '../core/errors.ts';
import { readJson } from '../core/files.ts';
import { log } from '../core/logging.ts';
import { standings, startTimes } from './identity.ts';
import type { ProcessRecord } from './identity.ts';

/** A record before its start time is read, as a program hands it in. */
export type Unstamped<R extends ProcessRecord> = Omit<R, 'startedAt'>;

/** How the file holds its records: `{ version, [field]: [...] }`. */
export interface RecordFormat {
	readonly version: number;
	readonly field: string;
}

export interface RecordFileOptions<R extends ProcessRecord> {
	/** One record, as the file holds it. */
	readonly schema: z.ZodType<R>;
	/** The name a record goes by, one record per name. */
	readonly nameOf: (record: R) => string;
	/**
	 * How a refusal or a listing names a record; `name (pid n)` by
	 * default.
	 */
	readonly describe?: (record: R) => string;
	/** Version 1, the records under `records`, by default. */
	readonly format?: RecordFormat;
}

/**
 * A JSON file of the processes a program left running, read and
 * written whole; a write lands by rename, so a reader never sees half
 * of one.
 */
export interface RecordFile<R extends ProcessRecord> {
	readonly path: string;
	readonly nameOf: (record: R) => string;
	/**
	 * The records, none while the file is absent; a file this program
	 * cannot read is a Failure naming it.
	 */
	read(): R[];
	/** Writes `records` as the whole file; none removes it. */
	write(records: readonly R[]): void;
	/**
	 * Records each of `running` with the start time its pid carries now,
	 * over a record of the same name, and answers those recorded; a pid
	 * already gone is left out, as nothing could stop it later.
	 */
	add(running: readonly Unstamped<R>[]): Promise<R[]>;
	/** Drops the records of `names`. */
	forget(names: readonly string[]): void;
	/**
	 * The records whose groups still live, by one `ps`; each other is
	 * logged as dropped, and stays in the file until a write.
	 */
	live(): Promise<R[]>;
	describe(records: readonly R[]): string;
}

const DEFAULT_FORMAT: RecordFormat = { version: 1, field: 'records' };

const writeWhole = (file: string, text: string): void => {
	mkdirSync(dirname(file), { recursive: true });
	const temporary = join(
		dirname(file),
		`.${basename(file)}.${process.pid}.${crypto.randomUUID()}`,
	);
	writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
	try {
		renameSync(temporary, file);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
};

export function recordFile<R extends ProcessRecord>(
	path: string,
	{
		schema,
		nameOf,
		describe = record => `${nameOf(record)} (pid ${record.pid})`,
		format = DEFAULT_FORMAT,
	}: RecordFileOptions<R>,
): RecordFile<R> {
	const envelope = z.object({
		version: z.literal(format.version),
		[format.field]: z.array(schema),
	});

	const refused = (reason: string) =>
		new Failure(
			`${path} is not a record this program reads (${reason}); check its processes by hand, then delete it`,
		);

	const read = (): R[] => {
		if (!existsSync(path)) return [];
		const loaded = readJson(path);
		if (!loaded.ok) throw refused(loaded.reason);
		const parsed = envelope.safeParse(loaded.value);
		if (!parsed.success)
			throw refused(
				parsed.error.issues
					.map(issue => `${issue.path.join('.')}: ${issue.message}`)
					.join('; '),
			);
		return parsed.data[format.field] as R[];
	};

	const write = (records: readonly R[]): void => {
		if (records.length === 0) {
			rmSync(path, { force: true });
			return;
		}
		const text = JSON.stringify(
			{ version: format.version, [format.field]: records },
			null,
			'\t',
		);
		writeWhole(path, `${text}\n`);
	};

	return {
		path,
		nameOf,
		read,
		write,
		async add(running) {
			const times = await startTimes(running.map(({ pid }) => pid));
			const added = running.flatMap(entry => {
				const startedAt = times.get(entry.pid);
				return startedAt === undefined
					? []
					: [schema.parse({ ...entry, startedAt })];
			});
			const names = new Set(added.map(nameOf));
			write([
				...read().filter(record => !names.has(nameOf(record))),
				...added,
			]);
			return added;
		},
		forget(names) {
			write(read().filter(record => !names.includes(nameOf(record))));
		},
		async live() {
			return (await standings(read())).flatMap(
				({ record, standing }) => {
					if (standing === 'running' || standing === 'leaderless')
						return [record];
					log.info(
						'{name} (pid {pid}) recorded earlier is {standing}; dropped',
						{ name: nameOf(record), pid: record.pid, standing },
					);
					return [];
				},
			);
		},
		describe: records => records.map(describe).join(', '),
	};
}
