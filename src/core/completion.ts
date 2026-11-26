import { fluent } from '@optique/core/modifiers';
import type { FluentParser } from '@optique/core/modifiers';
import type {
	Mode,
	Parser,
	ParserContext,
	Suggestion,
} from '@optique/core/parser';

const LONG = '--';

const offered = (
	suggestions: readonly Suggestion[],
): ReadonlySet<string> =>
	new Set(
		suggestions.flatMap(suggestion =>
			suggestion.kind === 'literal' ? [suggestion.text] : [],
		),
	);

/**
 * Whether `prefix` completes to every flag: a lone dash, which Optique
 * answers with the short names alone, or nothing at all where no
 * command, argument or value is offered, which it answers with none.
 * Words left unparsed mean an option waits for its value.
 */
const wantsFlags = <S>(
	context: ParserContext<S>,
	prefix: string,
	suggestions: readonly Suggestion[],
): boolean =>
	context.buffer.length === 0
	&& (prefix === '-' || (prefix === '' && suggestions.length === 0));

const unseen = (
	flags: readonly Suggestion[],
	suggestions: readonly Suggestion[],
): Suggestion[] => {
	const seen = offered(suggestions);
	return flags.filter(
		flag => flag.kind === 'literal' && !seen.has(flag.text),
	);
};

/**
 * `parser`, completing the flags of the command its words reach on a
 * lone dash, long names included, and on an empty word where nothing
 * else is offered; never while an option waits for its value.
 */
export function offeringFlags<M extends Mode, T, S>(
	parser: FluentParser<M, T, S>,
): FluentParser<M, T, S> {
	const inner: Parser<M, T, S> = parser;
	const suggest =
		inner.mode === 'sync'
			? function* (
					context: ParserContext<S>,
					prefix: string,
				): Iterable<Suggestion> {
					const suggestions = [
						...(inner.suggest(context, prefix) as Iterable<Suggestion>),
					];
					yield* suggestions;
					if (!wantsFlags(context, prefix, suggestions)) return;
					yield* unseen(
						[...(inner.suggest(context, LONG) as Iterable<Suggestion>)],
						suggestions,
					);
				}
			: async function* (
					context: ParserContext<S>,
					prefix: string,
				): AsyncIterable<Suggestion> {
					const suggestions = await Array.fromAsync(
						inner.suggest(context, prefix),
					);
					yield* suggestions;
					if (!wantsFlags(context, prefix, suggestions)) return;
					yield* unseen(
						await Array.fromAsync(inner.suggest(context, LONG)),
						suggestions,
					);
				};
	return fluent({ ...inner, suggest } as Parser<M, T, S>);
}
