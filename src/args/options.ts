import { message, text, valueSet } from '@optique/core/message';
import type { Message } from '@optique/core/message';
import { map, multiple } from '@optique/core/modifiers';
import type { FluentParser } from '@optique/core/modifiers';
import { option } from '@optique/core/primitives';
import type { NonEmptyString } from '@optique/core/nonempty';
import type { OptionName } from '@optique/core/usage';
import type {
	ValueParser,
	ValueParserResult,
} from '@optique/core/valueparser';

import { Refusal } from '../core/errors.ts';

const DEFAULT_SEPARATOR = ',';

const DEFAULT_NOUN = 'name';

const DEFAULT_NAMES_METAVAR = 'NAMES';

const DEFAULT_TIME_METAVAR = 'TIME';

// The names as a list, quoted, joined by commas alone.
const LIST = { fallback: '', type: 'unit' } as const;

const DURATION = /^(\d+)([smhd])$/;

// ECMAScript's date-time string format, the one Date reads the same on
// every engine; any other text Date may read as a year it guesses.
const ISO_TIME =
	/^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

const UNIT_MS: Readonly<Record<string, number>> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

/** The names a list completes against and judges, read when asked. */
export type KnownNames = () => readonly string[];

/** What one name names, as a refusal spells it. */
export interface Noun {
	/** One of them: `service`, `check`. */
	readonly noun: string;
	/** Several of them; the noun and an `s` by default. */
	readonly plural?: string;
}

export interface NameListOptions extends Partial<Noun> {
	/** `NAMES` by default. */
	readonly metavar?: NonEmptyString;
	/** `,` by default. */
	readonly separator?: string;
	/** Refuse a name outside the known ones at the parse, not later. */
	readonly strict?: boolean;
}

export interface NamesOptions extends NameListOptions {
	readonly description: Message;
}

export interface SelectOptions<T> extends Noun {
	/** The name an item goes by; the item itself for a string. */
	readonly nameOf?: (item: T) => string;
}

export interface SelectOneOptions<T> extends SelectOptions<T> {
	/** The command that takes one, as the refusal of several names it. */
	readonly verb: string;
}

export interface TimestampOptions {
	/** `TIME` by default. */
	readonly metavar?: NonEmptyString;
	/** The clock a duration reads back from; `Date.now` by default. */
	readonly now?: () => number;
}

const pluralOf = ({ noun, plural }: Noun): string =>
	plural ?? `${noun}s`;

const listOf = (noun: string, separator: string): string =>
	separator === DEFAULT_SEPARATOR
		? `comma-separated ${noun} names`
		: `${noun} names separated by ${JSON.stringify(separator)}`;

const theKnown = (known: readonly string[], noun: Noun): string =>
	known.length === 0
		? `there are no ${pluralOf(noun)}`
		: `the ${pluralOf(noun)} are ${known.join(', ')}`;

const unique = (names: readonly string[]): string[] => [
	...new Set(names),
];

const verdict = (unknown: readonly string[], noun: Noun): string =>
	unknown.length === 1
		? `is no ${noun.noun}`
		: `are no ${pluralOf(noun)}`;

// Help reads `choices`, so a source that throws, as one reading a
// project outside it does, must leave the list knowing nothing rather
// than break help.
const once = (known: KnownNames): KnownNames => {
	let read: readonly string[] | undefined;
	return () => {
		if (read === undefined) {
			try {
				read = known();
			} catch {
				read = [];
			}
		}
		return read;
	};
};

/**
 * A value of names, `separator`-joined and each trimmed, completing
 * against `known`; a blank name is refused, and under `strict` a name
 * `known` lacks.
 */
export function nameList(
	known: KnownNames,
	{
		metavar = DEFAULT_NAMES_METAVAR,
		noun = DEFAULT_NOUN,
		plural,
		separator = DEFAULT_SEPARATOR,
		strict = false,
	}: NameListOptions = {},
): ValueParser<'sync', readonly string[]> {
	const names = once(known);
	const what: Noun = { noun, plural };
	return {
		mode: 'sync',
		metavar,
		placeholder: [],
		// One list per known name, so the doc page and the builder see
		// them as `format` renders them.
		get choices(): readonly (readonly string[])[] | undefined {
			const all = names();
			return all.length === 0 ? undefined : all.map(name => [name]);
		},
		parse(input): ValueParserResult<readonly string[]> {
			const value = input.split(separator).map(name => name.trim());
			if (value.includes(''))
				return {
					success: false,
					error: message`Expected ${text(listOf(noun, separator))}, but got ${input}.`,
				};
			const unknown = strict
				? unique(value.filter(name => !names().includes(name)))
				: [];
			if (unknown.length > 0)
				return {
					success: false,
					error: message`${valueSet(unknown, LIST)} ${text(verdict(unknown, what))}; ${text(theKnown(names(), what))}.`,
				};
			return { success: true, value };
		},
		format: value => value.join(separator),
		// The names typed before the last separator are carried and left
		// out, so `api,` completes to `api,web` and never `api,api`.
		*suggest(prefix) {
			const at = prefix.lastIndexOf(separator);
			const head = prefix.slice(0, at + 1);
			const taken = head.split(separator);
			const partial = prefix.slice(at + 1);
			for (const name of names())
				if (name.startsWith(partial) && !taken.includes(name))
					yield { kind: 'literal', text: `${head}${name}` };
		},
	};
}

/**
 * The option `flags` over a `nameList`, separated or repeated, its
 * names flattened in the order written; `undefined` when none was
 * named, which a selection reads as every one.
 */
export const names = (
	flags: readonly [OptionName, ...OptionName[]],
	known: KnownNames,
	{ description, ...list }: NamesOptions,
): FluentParser<
	'sync',
	readonly string[] | undefined,
	readonly (ValueParserResult<readonly string[]> | undefined)[]
> =>
	map(
		multiple(option(...flags, nameList(known, list), { description })),
		(lists): readonly string[] | undefined =>
			lists.length === 0 ? undefined : lists.flat(),
	);

const itself = (item: unknown): string => String(item);

/**
 * The items `named`, in the items' order: every item when nothing is
 * named. A blank name, then any name no item goes by, is a `Refusal`
 * naming every such name and the items' names.
 */
export function selectNamed(
	items: readonly string[],
	named: readonly string[] | undefined,
	options: SelectOptions<string>,
): string[];

export function selectNamed<T>(
	items: readonly T[],
	named: readonly string[] | undefined,
	options: SelectOptions<T> & { readonly nameOf: (item: T) => string },
): T[];

export function selectNamed<T>(
	items: readonly T[],
	named: readonly string[] | undefined,
	{ nameOf = itself, ...noun }: SelectOptions<T>,
): T[] {
	if (named === undefined || named.length === 0) return [...items];
	const known = items.map(nameOf);
	const wanted = named.map(name => name.trim());
	if (wanted.includes(''))
		throw new Refusal(
			`a blank name is no ${noun.noun}; ${theKnown(known, noun)}`,
		);
	const unknown = unique(wanted.filter(name => !known.includes(name)));
	if (unknown.length > 0)
		throw new Refusal(
			`${unknown.join(', ')} ${verdict(unknown, noun)}; ${theKnown(known, noun)}`,
		);
	return items.filter(item => wanted.includes(nameOf(item)));
}

/**
 * The one item named, as `selectNamed` judges it, or none when nothing
 * is; several names are a `Refusal` by `verb`.
 */
export function selectOne(
	items: readonly string[],
	named: readonly string[] | undefined,
	options: SelectOneOptions<string>,
): string | undefined;

export function selectOne<T>(
	items: readonly T[],
	named: readonly string[] | undefined,
	options: SelectOneOptions<T> & {
		readonly nameOf: (item: T) => string;
	},
): T | undefined;

export function selectOne<T>(
	items: readonly T[],
	named: readonly string[] | undefined,
	{ verb, nameOf = itself, ...noun }: SelectOneOptions<T>,
): T | undefined {
	if (named !== undefined && named.length > 1)
		throw new Refusal(
			`${verb} takes one ${noun.noun} at a time; got ${named.join(', ')}`,
		);
	if (named === undefined || named.length === 0) return undefined;
	return selectNamed(items, named, { ...noun, nameOf })[0];
}

/**
 * A moment: a duration back from now (`30s`, `30m`, `2h`, `1d`), read
 * when the value parses, or an ISO time.
 */
export function timestamp({
	metavar = DEFAULT_TIME_METAVAR,
	now = Date.now,
}: TimestampOptions = {}): ValueParser<'sync', Date> {
	return {
		mode: 'sync',
		metavar,
		placeholder: new Date(0),
		parse(input): ValueParserResult<Date> {
			const duration = DURATION.exec(input);
			if (duration !== null)
				return {
					success: true,
					value: new Date(
						now()
							- Number(duration[1])
								* (UNIT_MS[duration[2] ?? 's'] ?? 0),
					),
				};
			const at = ISO_TIME.test(input) ? new Date(input) : undefined;
			if (at === undefined || Number.isNaN(at.getTime()))
				return {
					success: false,
					error: message`Expected a duration back from now (30m, 2h, 1d) or an ISO time, but got ${input}.`,
				};
			return { success: true, value: at };
		},
		format: value => value.toISOString(),
	};
}
