import type { Context } from './command.ts';
import { Refusal } from './errors.ts';

/**
 * Asks before something that cannot be undone: off a terminal the
 * caller's `--yes` is the only answer, and on one the developer types
 * `word`; anything else is a Refusal saying `untouched`. A dry run
 * undoes nothing, so it asks nothing.
 */
export async function confirmed(
	ctx: Context,
	{
		yes,
		what,
		word,
		untouched,
	}: {
		readonly yes: boolean;
		/** What would happen, as the question names it. */
		readonly what: string;
		readonly word: string;
		/** What the refusal says was left as it is. */
		readonly untouched: string;
	},
): Promise<void> {
	if (yes || ctx.dryRun) return;
	if (ctx.stdin.isTTY !== true)
		throw new Refusal(
			`${what} needs --yes when stdin is not a terminal`,
		);
	const answer = await ctx.prompt(`Type ${word} to ${what}: `);
	if (answer !== word)
		throw new Refusal(
			`${JSON.stringify(answer)} is not ${word}; ${untouched}`,
		);
}
