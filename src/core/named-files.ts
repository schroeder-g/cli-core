import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Refusal } from './errors.ts';
import { shellLine, shellWord } from './plan.ts';

const NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** @public */
export interface NamedFile {
	readonly name: string;
	readonly file: string;
	readonly bytes: number;
	readonly savedAt: Date;
}

/** @public */
export interface NamedFilesSpec {
	/**
	 * The directory the files live in, asked on every use, so it follows
	 * the environment it is read from.
	 */
	readonly dir: () => string;
	/** What each file's name ends with: `.dump`. */
	readonly extension: string;
	/** What the refusals call one of the files: `snapshot`. */
	readonly noun: string;
	/** What the refusal of a name nothing is saved under goes on to say. */
	readonly listHint?: string;
}

/** @public */
export interface NamedFiles {
	readonly dir: () => string;
	/** The file of `name`; a Refusal when `name` is no name. */
	fileOf(name: string): string;
	/** What is saved, newest first; none when the directory is absent. */
	list(): NamedFile[];
	/** Refuses a name nothing is saved under. */
	assertSaved(name: string): void;
	remove(name: string): void;
	/**
	 * The argv of a shell command that saves `argv`'s stdout as `name`,
	 * making the directory: the output goes to a temporary file beside
	 * the name's and is renamed over it once `argv` succeeds, so a save
	 * that fails leaves the file it would have replaced.
	 */
	saveCommand(name: string, argv: readonly string[]): string[];
}

/**
 * Files saved under names in one directory, a name being lower-case
 * letters, digits, - and _, a letter or digit first, so it is a file
 * name everywhere.
 *
 * @public
 */
export function namedFiles({
	dir,
	extension,
	noun,
	listHint,
}: NamedFilesSpec): NamedFiles {
	const fileOf = (name: string): string => {
		if (!NAME.test(name))
			throw new Refusal(
				`${JSON.stringify(name)} is no ${noun} name: lower-case letters, digits, - and _, a letter or digit first`,
			);
		return join(dir(), `${name}${extension}`);
	};

	const list = (): NamedFile[] => {
		const at = dir();
		let names: string[];
		try {
			names = readdirSync(at);
		} catch {
			return [];
		}
		return names
			.filter(name => name.endsWith(extension))
			.map(name => {
				const file = join(at, name);
				const stat = statSync(file);
				return {
					name: name.slice(0, -extension.length),
					file,
					bytes: stat.size,
					savedAt: stat.mtime,
				};
			})
			.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
	};

	const assertSaved = (name: string): void => {
		if (!list().some(saved => saved.name === name))
			throw new Refusal(
				`no ${noun} is named ${name}${listHint === undefined ? '' : `; ${listHint}`}`,
			);
	};

	// The temporary file starts with a dot and ends past the extension,
	// so a listing never shows it.
	const saveCommand = (
		name: string,
		argv: readonly string[],
	): string[] => {
		const file = fileOf(name);
		const at = shellWord(dir());
		const partial = shellWord(join(dir(), `.${name}.XXXXXX`));
		return [
			'bash',
			'-c',
			`mkdir -p ${at} && partial=$(mktemp ${partial}) && trap 'rm -f -- "$partial"' EXIT && ${shellLine(argv)} > "$partial" && mv -f -- "$partial" ${shellWord(file)}`,
		];
	};

	return {
		dir,
		fileOf,
		list,
		assertSaved,
		remove: name => {
			rmSync(fileOf(name));
		},
		saveCommand,
	};
}
