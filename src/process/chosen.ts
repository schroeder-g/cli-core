import type { Action, Awaitable, Context } from '../core/command.ts';
import { INTERRUPTED } from '../core/exit.ts';
import { planLines } from '../core/plan.ts';
import type { Plan } from '../core/plan.ts';
import { runPlan } from './run.ts';

/** How asking ended: with what was chosen, or cancelled. */
export type Choice<T> =
	| { readonly chosen: T }
	| { readonly cancelled: true };

export interface ChosenPlan<T, C extends Context> {
	/** The plan with nothing chosen, which `--dry-run` describes. */
	readonly unchosen: () => Plan<C>;
	/**
	 * Asks for the choice, on a screen for one; `undefined` once an
	 * interrupt or the input's end cut it short.
	 */
	readonly choose: (ctx: C) => Awaitable<Choice<T> | undefined>;
	readonly plan: (chosen: T) => Plan<C>;
}

/**
 * An action that asks before it plans: a run awaits `choose`, then runs
 * the plan the choice gives and answers its code. A cancelled choice
 * runs nothing and answers 0, an interrupted one `INTERRUPTED`.
 */
export function chosenPlan<T, C extends Context = Context>({
	unchosen,
	choose,
	plan,
}: ChosenPlan<T, C>): Action<C> {
	return {
		describe: root => {
			const bare = unchosen();
			return [
				...planLines(bare, root),
				...(bare.then?.describe(root) ?? []),
			];
		},
		run: async ctx => {
			const choice = await choose(ctx);
			if (choice === undefined) return INTERRUPTED;
			if (!('chosen' in choice)) return 0;
			return runPlan(plan(choice.chosen), ctx);
		},
	};
}
