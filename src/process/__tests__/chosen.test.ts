import { describe, expect, test } from 'bun:test';

import type { Context } from '../../core/command.ts';
import { INTERRUPTED } from '../../core/exit.ts';
import type { Plan } from '../../core/plan.ts';
import { capture, testContext } from '../../testing/index.ts';
import { chosenPlan } from '../chosen.ts';
import type { Choice } from '../chosen.ts';

const ROOT = '/repo';

/** A plan that echoes `words`, then exits `code`. */
const echoing = (words: readonly string[], code = 0): Plan => ({
	steps: [
		{
			title: 'Echo the choice',
			cwd: '.',
			argv: ['sh', '-c', `echo "$*"; exit ${code}`, 'sh', ...words],
		},
	],
	then: {
		describe: () => ['then tidy up'],
		run: () => Promise.resolve(0),
	},
});

/** The action over a chooser answering `choice`, and what it saw. */
const over = (
	choice: Choice<readonly string[]> | undefined,
	code = 0,
) => {
	const seen: { asked?: Context; planned: (readonly string[])[] } = {
		planned: [],
	};
	const action = chosenPlan<readonly string[]>({
		unchosen: () => echoing([]),
		choose: ctx => {
			seen.asked = ctx;
			return Promise.resolve(choice);
		},
		plan: words => {
			seen.planned.push(words);
			return echoing(words, code);
		},
	});
	return { action, seen };
};

const capturedContext = () => {
	const stdout = capture();
	return { ctx: testContext(process.cwd(), { stdout }), stdout };
};

describe('chosenPlan', () => {
	test('a dry run describes the plan nothing chosen gives, then its action, and asks nothing', () => {
		const { action, seen } = over({ chosen: ['a'] });
		expect(action.describe(ROOT)).toEqual([
			'# Echo the choice',
			`$ sh -c 'echo "$*"; exit 0' sh`,
			'  cwd: .',
			'then tidy up',
		]);
		expect(seen.asked).toBeUndefined();
	});

	test('a run asks, then runs the plan the choice gives and answers its code', async () => {
		const { action, seen } = over({ chosen: ['a', 'b'] }, 3);
		const { ctx, stdout } = capturedContext();
		expect(await action.run(ctx)).toBe(3);
		expect(seen.asked).toBe(ctx);
		expect(seen.planned).toEqual([['a', 'b']]);
		expect(stdout.text()).toContain('a b\n');
	});

	test('a cancelled choice runs nothing and answers 0', async () => {
		const { action, seen } = over({ cancelled: true });
		const { ctx, stdout } = capturedContext();
		expect(await action.run(ctx)).toBe(0);
		expect(seen.planned).toEqual([]);
		expect(stdout.text()).toBe('');
	});

	test('an interrupted choice runs nothing and answers as an interrupt', async () => {
		const { action, seen } = over(undefined);
		const { ctx } = capturedContext();
		expect(await action.run(ctx)).toBe(INTERRUPTED);
		expect(seen.planned).toEqual([]);
	});
});
