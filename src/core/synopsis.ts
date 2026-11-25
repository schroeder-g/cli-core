import { group } from '@optique/core/constructs';
import type { Mode, Parser } from '@optique/core/parser';
import type { Usage, UsageTerm } from '@optique/core/usage';

/** The section the commands of a program or a group are listed under. */
export const COMMANDS_SECTION = 'Commands';
/** The section the flags beside those commands are listed under. */
export const FLAGS_SECTION = 'Flags';

// Optique's group() leaves this marker off the parser it wraps, so a
// config-bound option under one never sees the loaded config.
const INHERITS_ANNOTATIONS = Symbol.for(
	'@optique/core/inheritParentAnnotations',
);

const COMMAND_SLOT: UsageTerm = {
	type: 'sequence',
	terms: [
		{ type: 'argument', metavar: 'COMMAND' },
		{
			type: 'optional',
			terms: [
				{
					type: 'multiple',
					terms: [{ type: 'argument', metavar: 'ARG' }],
					min: 1,
				},
			],
		},
	],
};

/** `parser`, its entries listed under `label` in help. */
export function section<M extends Mode, T, S>(
	label: string,
	parser: Parser<M, T, S>,
): Parser<M, T, S> {
	const titled = group(label, parser);
	if (INHERITS_ANNOTATIONS in parser)
		Object.defineProperty(titled, INHERITS_ANNOTATIONS, {
			value: true,
			configurable: true,
			enumerable: false,
		});
	return titled;
}

/** `[flags] COMMAND [ARG...]`: the synopsis of a program over `flags`. */
export const synopsisOver = (flags: Usage): Usage => [
	...flags,
	COMMAND_SLOT,
];

const isCommands = (term: UsageTerm): boolean =>
	term.type === 'exclusive'
	&& term.terms.every(
		alternative => alternative[0]?.type === 'command',
	);

/**
 * A group's usage with its commands folded into `COMMAND [ARG...]`
 * after the flags: the synopsis names what kind of word comes next and
 * leaves each command's grammar to its own help. A usage naming no
 * commands is returned as it is.
 */
export function synopsis(usage: Usage): Usage {
	const flags = usage.filter(term => !isCommands(term));
	return flags.length === usage.length ? usage : synopsisOver(flags);
}
