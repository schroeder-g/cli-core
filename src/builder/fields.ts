import { isDocEntryHidden } from '@optique/core/doc';
import type { DocEntry, DocPage } from '@optique/core/doc';
import { formatMessage } from '@optique/core/message';
import type { Message } from '@optique/core/message';
import { getDocPage, suggest } from '@optique/core/parser';
import type { Mode, Parser } from '@optique/core/parser';
import type { Usage, UsageTerm } from '@optique/core/usage';

import { shellLine } from '../core/plan.ts';

const SECRET_NAME = /password|passphrase|secret|token/i;

const PASSTHROUGH_KEY = '--';

export type AnyParser = Parser<Mode, unknown, unknown>;

type FieldKind =
	| 'flag'
	| 'value'
	| 'choice'
	| 'multi'
	| 'positional'
	| 'passthrough';

/**
 * One input of a leaf's form: an option (`names`), an argument
 * (`metavar` alone) or a pass-through term. A `multi` repeats: an
 * option per word, a positional per word after `--`, or a flag as many
 * times as its count when it has no metavar. A `secret` field's value
 * is never shown.
 */
export interface Field {
	readonly kind: FieldKind;
	readonly names: readonly string[];
	readonly metavar?: string;
	readonly description: string;
	readonly choices?: readonly string[];
	readonly required: boolean;
	readonly secret: boolean;
	readonly staticDefault?: string;
}

export interface Level {
	readonly name: string;
	readonly description: string;
}

/** A field with what was entered for it; `''` leaves it out. */
export interface Filled {
	readonly field: Field;
	readonly value: string;
}

interface Shape {
	readonly optional: boolean;
	readonly repeatable: boolean;
}

type FieldTerm = Extract<
	UsageTerm,
	{ type: 'option' | 'argument' | 'passthrough' }
>;

const ROOT_SHAPE: Shape = { optional: false, repeatable: false };

const plain = (text: Message | undefined): string =>
	text === undefined
		? ''
		: formatMessage(text, { colors: false, quotes: false });

const isFieldTerm = (term: UsageTerm): term is FieldTerm =>
	term.type === 'option'
	|| term.type === 'argument'
	|| term.type === 'passthrough';

const termKey = (term: FieldTerm): string => {
	switch (term.type) {
		case 'option':
			return term.names.join(' ');
		case 'argument':
			return term.metavar;
		default:
			return PASSTHROUGH_KEY;
	}
};

const entriesOf = (found: DocPage | undefined): DocEntry[] =>
	(found?.sections ?? [])
		.flatMap(section => section.entries)
		.filter(entry => !isDocEntryHidden(entry));

// The usage tree says what the entries do not: which terms are optional
// and which repeat. Each term is keyed by its surface syntax, so the
// first occurrence of a key wins.
const indexUsage = (
	usage: Usage,
	shape: Shape,
	into: Map<string, Shape>,
): void => {
	for (const term of usage) {
		switch (term.type) {
			case 'optional':
				indexUsage(term.terms, { ...shape, optional: true }, into);
				break;
			case 'multiple':
				indexUsage(
					term.terms,
					{
						optional: shape.optional || term.min === 0,
						repeatable: true,
					},
					into,
				);
				break;
			case 'exclusive':
				for (const branch of term.terms)
					indexUsage(branch, { ...shape, optional: true }, into);
				break;
			case 'sequence':
				indexUsage(term.terms, shape, into);
				break;
			default:
				if (isFieldTerm(term) && !into.has(termKey(term)))
					into.set(termKey(term), shape);
		}
	}
};

const kindOf = (
	term: FieldTerm,
	shape: Shape,
	hasChoices: boolean,
): FieldKind => {
	if (term.type === 'passthrough') return 'passthrough';
	if (shape.repeatable) return 'multi';
	if (term.type === 'argument')
		return hasChoices ? 'choice' : 'positional';
	if (term.metavar === undefined) return 'flag';
	return hasChoices ? 'choice' : 'value';
};

const words = (tokens: readonly string[]): [string, ...string[]] => {
	const [first = '', ...rest] = tokens;
	return [first, ...rest];
};

const literals = async (
	program: AnyParser,
	tokens: readonly string[],
): Promise<string[]> => {
	const found = await suggest(program, words(tokens));
	return found.flatMap(s => (s.kind === 'literal' ? [s.text] : []));
};

const longName = (names: readonly string[]): string =>
	names.find(name => name.startsWith('--')) ?? names[0] ?? '';

// An option's raw values come from completion after its name; an
// argument's from its documented list, since completion at a positional
// offers every positional's literals at once.
const choicesOf = (
	program: AnyParser,
	path: readonly string[],
	term: FieldTerm,
	documented: Message,
): Promise<string[]> =>
	term.type === 'option'
		? literals(program, [...path, longName(term.names), ''])
		: Promise.resolve(plain(documented).split(', '));

const isSecret = (term: FieldTerm): boolean =>
	term.type !== 'passthrough'
	&& [
		...(term.type === 'option' ? term.names : []),
		term.metavar ?? '',
	].some(name => SECRET_NAME.test(name));

/** Where a path lands: how far down it resolves, and what lies below. */
export interface Place {
	/** The words of the path the page resolved, a group or a leaf at each. */
	readonly path: string[];
	readonly levels: Level[];
}

/** The leaf or group a page describes, with the form of its leaf. */
export interface Described extends Place {
	readonly fields: Field[];
}

// A page is found for the longest prefix of the path that names
// commands; the prefix is read back from the leading command terms of
// its usage.
const resolvedPath = (found: DocPage | undefined): string[] => {
	const words: string[] = [];
	for (const term of found?.usage ?? []) {
		if (term.type !== 'command') break;
		words.push(term.name);
	}
	return words;
};

const levelsOf = (found: DocPage | undefined): Level[] =>
	entriesOf(found).flatMap(entry =>
		entry.term.type === 'command'
			? [
					{
						name: entry.term.name,
						description: plain(entry.description),
					},
				]
			: [],
	);

async function fieldsOf(
	program: AnyParser,
	path: readonly string[],
	found: DocPage | undefined,
): Promise<Field[]> {
	const shapes = new Map<string, Shape>();
	indexUsage(found?.usage ?? [], ROOT_SHAPE, shapes);
	const seen = new Set<string>();
	const entries = entriesOf(found).filter(({ term }) => {
		if (!isFieldTerm(term) || seen.has(termKey(term))) return false;
		seen.add(termKey(term));
		return true;
	});
	return Promise.all(
		entries.map(async (entry): Promise<Field> => {
			const term = entry.term as FieldTerm;
			const shape = shapes.get(termKey(term)) ?? ROOT_SHAPE;
			const choices =
				entry.choices === undefined
					? undefined
					: await choicesOf(program, path, term, entry.choices);
			const kind = kindOf(term, shape, choices !== undefined);
			return {
				kind,
				names: term.type === 'option' ? term.names : [],
				metavar: term.type === 'passthrough' ? undefined : term.metavar,
				description: plain(entry.description),
				choices,
				required: !shape.optional && term.type !== 'passthrough',
				secret: isSecret(term),
				staticDefault:
					entry.default === undefined
						? undefined
						: plain(entry.default),
			};
		}),
	);
}

/**
 * What one doc page says of `path`: the subcommands documented there,
 * in the parser's order, and the form of the leaf there, one field per
 * option, argument and pass-through, the run's globals included, in
 * the documented order.
 */
export async function describe(
	program: AnyParser,
	path: readonly string[],
): Promise<Described> {
	const found = await getDocPage(program, path);
	return {
		path: resolvedPath(found),
		levels: levelsOf(found),
		fields: await fieldsOf(program, path, found),
	};
}

/**
 * Where `path` lands, without the leaf's form: what a run needs to
 * route it, at a fraction of describing it.
 */
export async function place(
	program: AnyParser,
	path: readonly string[],
): Promise<Place> {
	const found = await getDocPage(program, path);
	return { path: resolvedPath(found), levels: levelsOf(found) };
}

/** The subcommands documented at `path`, in the parser's order. */
export const levels = async (
	program: AnyParser,
	path: readonly string[],
): Promise<Level[]> => levelsOf(await getDocPage(program, path));

/** The form of the leaf at `path`. */
export const form = async (
	program: AnyParser,
	path: readonly string[],
): Promise<Field[]> =>
	fieldsOf(program, path, await getDocPage(program, path));

/**
 * The words of a free-text value, split as a POSIX shell splits them:
 * blanks separate, single quotes keep everything, double quotes keep
 * everything but a backslash escape, a backslash keeps the next
 * character. A quote left open runs to the end.
 */
export function splitWords(text: string): string[] {
	const found: string[] = [];
	let word = '';
	let open = false;
	let quote: string | undefined;
	for (let i = 0; i < text.length; i++) {
		const char = text[i] ?? '';
		if (quote !== undefined) {
			if (char === quote) quote = undefined;
			else if (char === '\\' && quote === '"' && i + 1 < text.length)
				word += text[++i];
			else word += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			open = true;
		} else if (char === '\\' && i + 1 < text.length) {
			word += text[++i];
			open = true;
		} else if (/\s/.test(char)) {
			if (open) found.push(word);
			word = '';
			open = false;
		} else {
			word += char;
			open = true;
		}
	}
	if (open) found.push(word);
	return found;
}

/** The words as one free-text value `splitWords` reads back. */
export const joinWords = (found: readonly string[]): string =>
	shellLine(found);

const count = (value: string): number =>
	/^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;

const repeated = (field: Field, value: string): string[] => {
	const name = longName(field.names);
	if (field.names.length === 0) return [];
	if (field.metavar === undefined)
		return Array.from({ length: count(value) }, () => name);
	return splitWords(value).flatMap(each => [name, each]);
};

/**
 * The argv of a filled form: the path, then each field in documented
 * order, then `--` and the words of every repeated positional and
 * pass-through, which the parser reads there and nowhere an option
 * token could be mistaken for one of its own. Nothing is validated
 * here; the parser judges the result.
 */
export function toArgv(
	path: readonly string[],
	filled: readonly Filled[],
): string[] {
	const argv = [...path];
	const after: string[] = [];
	for (const { field, value } of filled) {
		if (value === '') continue;
		switch (field.kind) {
			case 'flag':
				argv.push(longName(field.names));
				break;
			case 'value':
				argv.push(longName(field.names), value);
				break;
			case 'choice':
				if (field.names.length > 0) argv.push(longName(field.names));
				argv.push(value);
				break;
			case 'positional':
				argv.push(value);
				break;
			case 'multi':
				if (field.names.length > 0)
					argv.push(...repeated(field, value));
				else after.push(...splitWords(value));
				break;
			case 'passthrough':
				after.push(...splitWords(value));
				break;
		}
	}
	return after.length === 0 ? argv : [...argv, '--', ...after];
}

/** The line a shell would take for `argv` under the program `name`. */
export const commandLine = (
	name: string,
	argv: readonly string[],
): string => shellLine([name, ...argv]);
