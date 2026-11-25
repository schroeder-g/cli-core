import type { LogLevel } from '@logtape/logtape';
import type { Usage } from '@optique/core/usage';

export const DRY_RUN_OPTION = '--dry-run';

export const CONFIG_OPTION = '--config';

export const QUIET_FLAGS = ['-q', '--quiet'] as const;

export const VERBOSE_SHORT = '-v';

export const VERBOSE_LONG = '--verbose';

export const BASE_LEVEL: LogLevel = 'info';

/** The help option's spellings, the short one as every CLI has it. */
export const HELP_FLAGS = ['-h', '--help'] as const;

export const COMPLETION = 'completion';

export const HELP = 'help';

const VERBOSE_LEVELS: readonly LogLevel[] = [
	BASE_LEVEL,
	'debug',
	'trace',
];

const isOption = (token: string) => token.startsWith('-');

const isQuiet = (token: string): boolean =>
	(QUIET_FLAGS as readonly string[]).includes(token);

const isVerbose = (token: string): boolean =>
	token === VERBOSE_LONG || /^-v+$/.test(token);

const isGlobal = (token: string): boolean =>
	token === DRY_RUN_OPTION
	|| token === CONFIG_OPTION
	|| isQuiet(token)
	|| isVerbose(token);

/** The tokens before `--`, the only ones the reader reads. */
const beforeTerminator = (
	argv: readonly string[],
): readonly string[] =>
	argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv;

const valuedNames = (terms: Usage): string[] =>
	terms.flatMap(term => {
		switch (term.type) {
			case 'option':
				return term.metavar === undefined ? [] : [...term.names];
			case 'exclusive':
				return term.terms.flatMap(valuedNames);
			case 'optional':
			case 'multiple':
			case 'sequence':
				return valuedNames(term.terms);
			default:
				return [];
		}
	});

/** Every option name in `usage` whose next token is its value. */
export const valuedOptions = (usage: Usage): ReadonlySet<string> =>
	new Set(valuedNames(usage));

/**
 * An argv read lexically, before or instead of the parse, knowing
 * which options take the next token as their value.
 */
export interface ArgvReader {
	/**
	 * The command words: every option, the value of a valued one, and
	 * `--` skipped.
	 */
	readonly words: (argv: readonly string[]) => string[];
	/** The option tokens, a valued option's value included. */
	readonly optionTokens: (argv: readonly string[]) => string[];
	/** An argv of globals alone, which opens the builder on a terminal. */
	readonly bare: (argv: readonly string[]) => boolean;
	/**
	 * The command words of an argv that carries nothing but them and the
	 * globals: no other option, no `--`. Empty for any other argv.
	 */
	readonly plainWords: (argv: readonly string[]) => string[];
	readonly wantsHelp: (argv: readonly string[]) => boolean;
}

export function argvReader(valued: ReadonlySet<string>): ArgvReader {
	const words = (argv: readonly string[]): string[] => {
		const found: string[] = [];
		for (let i = 0; i < argv.length; i++) {
			const token = argv[i] ?? '';
			if (valued.has(token)) i++;
			else if (!isOption(token)) found.push(token);
		}
		return found;
	};

	return {
		words,
		optionTokens: argv =>
			argv.filter(
				(token, i) => isOption(token) || valued.has(argv[i - 1] ?? ''),
			),
		bare: argv => words(argv).length === 0 && argv.every(isGlobal),
		plainWords: argv =>
			argv.every(token => !isOption(token) || isGlobal(token))
				? words(argv)
				: [],
		// Help shows static defaults and reads no source; and under Optique
		// 1.3.6 a registered context annotates a group's undefined state
		// into an object its `or` cannot render help from ("{} is not
		// iterable").
		wantsHelp: argv =>
			beforeTerminator(argv).some(token =>
				(HELP_FLAGS as readonly string[]).includes(token),
			) || words(argv)[0] === HELP,
	};
}

/**
 * The file `--config` names, read lexically, for a run that skips the
 * parse.
 */
export const configFromArgv = (
	argv: readonly string[],
): string | undefined => {
	const tokens = beforeTerminator(argv);
	const at = tokens.indexOf(CONFIG_OPTION);
	return at === -1 ? undefined : tokens[at + 1];
};

/**
 * The level the globals name, read lexically for what is logged before
 * the parse; the parsed value replaces it afterwards.
 */
export function levelFromArgv(argv: readonly string[]): LogLevel {
	let verbose = 0;
	for (const token of argv) {
		if (token === '--') break;
		if (isQuiet(token)) return 'error';
		if (token === VERBOSE_LONG) verbose++;
		else if (isVerbose(token)) verbose += token.length - 1;
	}
	return (
		VERBOSE_LEVELS[Math.min(verbose, VERBOSE_LEVELS.length - 1)]
		?? BASE_LEVEL
	);
}
