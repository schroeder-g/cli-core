import { readFileSync } from 'node:fs';

import { messageOf, codeOf } from './errors.ts';

/**
 * A file read and parsed, or why it could not be: `code` is the fs
 * error's when the file itself could not be read, and absent when it
 * did not parse.
 */
export type Loaded<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly reason: string;
			readonly code?: string;
	  };

function loaded<T>(
	file: string,
	parse: (text: string) => T,
): Loaded<T> {
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		return { ok: false, reason: messageOf(error), code: codeOf(error) };
	}
	try {
		return { ok: true, value: parse(text) };
	} catch (error) {
		return { ok: false, reason: messageOf(error) };
	}
}

export const readJson = (file: string): Loaded<unknown> =>
	loaded(file, text => JSON.parse(text) as unknown);

export const readToml = (file: string): Loaded<unknown> =>
	loaded(file, text => Bun.TOML.parse(text) as unknown);
