import { messageOf, Refusal } from '../core/errors.ts';

/**
 * Expects `pending` to reject with a `Refusal` whose message holds each
 * of `texts`, and answers it; anything else fails, under any runner.
 */
export async function refused(
	pending: Promise<unknown>,
	...texts: readonly string[]
): Promise<Refusal> {
	const outcome = await pending.then(
		() => ({ rejected: false as const }),
		(error: unknown) => ({ rejected: true as const, error }),
	);
	if (!outcome.rejected)
		throw new Error('expected a Refusal, but the run resolved');
	const { error } = outcome;
	if (!(error instanceof Refusal))
		throw new Error(
			`expected a Refusal, but the run threw ${error instanceof Error ? `${error.name}: ` : ''}${messageOf(error)}`,
		);
	for (const text of texts)
		if (!error.message.includes(text))
			throw new Error(
				`the Refusal does not hold ${JSON.stringify(text)}: ${error.message}`,
			);
	return error;
}
