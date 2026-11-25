import { Refusal } from './errors.ts';

/** A thing that needs others up before it, by name. */
export interface Dependent {
	readonly name: string;
	readonly needs: readonly string[];
}

/**
 * The needs relation over a list of nodes. Every answer lists names in
 * the order the nodes were given, so nodes given in start order answer
 * in start order; a name the graph lacks throws.
 */
export interface DependencyGraph<N extends Dependent = Dependent> {
	readonly nodes: readonly N[];
	readonly node: (name: string) => N;
	/** `names` and everything they need, however far. */
	readonly closure: (names: readonly string[]) => string[];
	/** Everything that needs `name`, however far. */
	readonly dependents: (name: string) => string[];
	/** `names` and everything that needs them, however far. */
	readonly downstream: (names: readonly string[]) => string[];
}

export interface DependencyOptions {
	/**
	 * What a name the graph lacks throws; by default a Refusal naming
	 * every node.
	 */
	readonly unknown?: (name: string, names: readonly string[]) => Error;
}

const notKnown = (name: string, names: readonly string[]): Error =>
	new Refusal(
		`${name} is not known; the names are ${names.join(', ')}`,
	);

export function dependencyGraph<N extends Dependent>(
	nodes: readonly N[],
	{ unknown = notKnown }: DependencyOptions = {},
): DependencyGraph<N> {
	const names = nodes.map(node => node.name);
	const byName = new Map(nodes.map(node => [node.name, node]));
	const neededBy = new Map<string, string[]>(
		names.map(name => [name, []]),
	);
	for (const { name, needs } of nodes)
		for (const need of needs) neededBy.get(need)?.push(name);

	const node = (name: string): N => {
		const found = byName.get(name);
		if (found === undefined) throw unknown(name, names);
		return found;
	};

	const ordered = (seen: ReadonlySet<string>): string[] =>
		names.filter(name => seen.has(name));

	const reach = (
		from: readonly string[],
		next: (name: string) => readonly string[],
	): Set<string> => {
		const seen = new Set<string>();
		const stack = [...from];
		for (let name = stack.pop(); name !== undefined; name = stack.pop())
			for (const other of next(name))
				if (!seen.has(other)) {
					seen.add(other);
					stack.push(other);
				}
		return seen;
	};

	const dependentsOf = (name: string): Set<string> => {
		node(name);
		return reach([name], other => neededBy.get(other) ?? []);
	};

	return {
		nodes,
		node,
		closure: chosen => {
			for (const name of chosen) node(name);
			const seen = reach(chosen, name => node(name).needs);
			return ordered(new Set([...chosen, ...seen]));
		},
		dependents: name => ordered(dependentsOf(name)),
		downstream: chosen =>
			ordered(
				new Set(chosen.flatMap(name => [name, ...dependentsOf(name)])),
			),
	};
}

/**
 * A checklist's rules that keep the checked names closed over a
 * dependency graph, with the notice a refused uncheck shows; they fit
 * `useChecklistScreen` and `ChecklistView` as they are.
 */
export interface DependencyRules {
	/** What checking `name` checks with it, itself included. */
	readonly pull: (name: string) => readonly string[];
	/** The checked names that keep `name` checked. */
	readonly holds: (
		name: string,
		checked: ReadonlySet<string>,
	) => readonly string[];
	readonly heldNotice: (name: string, by: readonly string[]) => string;
}

const them = (by: readonly string[]): string =>
	by.length === 1 ? by[0]! : 'them';

/**
 * For choosing what to bring up: checking a name checks all it needs,
 * and a name stays checked while a checked one needs it.
 */
export const pullingNeeds = (
	graph: Pick<DependencyGraph, 'closure' | 'dependents'>,
): DependencyRules => ({
	pull: name => graph.closure([name]),
	holds: (name, checked) =>
		graph.dependents(name).filter(other => checked.has(other)),
	heldNotice: (name, by) =>
		`${by.join(', ')} ${by.length === 1 ? 'needs' : 'need'} ${name}; uncheck ${them(by)} first`,
});

/**
 * For choosing what to take down: checking a name checks all that
 * needs it, and a name stays checked while one it needs is checked.
 */
export const pullingDependents = (
	graph: Pick<DependencyGraph, 'closure' | 'downstream'>,
): DependencyRules => ({
	pull: name => graph.downstream([name]),
	holds: (name, checked) =>
		graph
			.closure([name])
			.filter(other => other !== name && checked.has(other)),
	heldNotice: (name, by) =>
		`${name} needs ${by.join(', ')}; uncheck ${them(by)} first`,
});
