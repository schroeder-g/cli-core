import { Refusal } from '../core/errors.ts';
import { cleanTree, currentBranch } from './queries.ts';

/**
 * The one `BranchGate.branches` entry that admits any branch.
 *
 * @public
 */
export const ANY_BRANCH = '*';

/**
 * Where a command may run from: the branches, `ANY_BRANCH` among them
 * for any, and whether the tree must hold no uncommitted or untracked
 * file.
 *
 * @public
 */
export interface BranchGate {
	readonly branches: readonly string[];
	readonly cleanTree: boolean;
}

/**
 * A checkout as a gate reads it: `branch` is undefined when HEAD is
 * detached.
 *
 * @public
 */
export interface TreeState {
	readonly branch: string | undefined;
	readonly clean: boolean;
}

/**
 * The branch a gate admits, or why it refuses the checkout.
 *
 * @public
 */
export type GateVerdict =
	| { readonly branch: string }
	| { readonly refusal: string };

const ruleOf = ({ branches, cleanTree }: BranchGate): string => {
	const from = branches.includes(ANY_BRANCH)
		? 'from any branch'
		: `only from ${branches.join(' or ')}`;
	return `${from}${cleanTree ? ' with a clean tree' : ''}`;
};

/**
 * The gate's verdict on a checkout: a detached HEAD is refused under
 * any gate, then a branch the gate does not list, then a dirty tree.
 * `subject` opens the refusal, before the rule: `release runs` reads
 * `release runs only from main with a clean tree, not from fix`.
 *
 * @public
 */
export function gateVerdict(
	subject: string,
	gate: BranchGate,
	{ branch, clean }: TreeState,
): GateVerdict {
	const rule = `${subject} ${ruleOf(gate)}`;
	if (branch === undefined)
		return { refusal: `${rule}; HEAD is detached, on no branch` };
	if (
		!gate.branches.includes(ANY_BRANCH)
		&& !gate.branches.includes(branch)
	)
		return { refusal: `${rule}, not from ${branch}` };
	if (gate.cleanTree && !clean)
		return {
			refusal: `${rule}; ${branch} has uncommitted or untracked files (git status --porcelain)`,
		};
	return { branch };
}

/**
 * The checkout at `root` as a gate reads it.
 *
 * @public
 */
export async function treeState(root: string): Promise<TreeState> {
	const [branch, clean] = await Promise.all([
		currentBranch(root),
		cleanTree(root),
	]);
	return { branch, clean };
}

/**
 * The branch the gate admits for the checkout at `root`, read once; a
 * `Refusal` naming the root when it refuses.
 *
 * @public
 */
export async function assertGate(
	root: string,
	subject: string,
	gate: BranchGate,
): Promise<string> {
	const verdict = gateVerdict(subject, gate, await treeState(root));
	if ('refusal' in verdict)
		throw new Refusal(`${verdict.refusal}, at ${root}`);
	return verdict.branch;
}
