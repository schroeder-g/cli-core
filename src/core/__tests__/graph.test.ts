import { describe, expect, test } from 'bun:test';

import { Refusal } from '../errors.ts';
import {
	dependencyGraph,
	pullingDependents,
	pullingNeeds,
} from '../graph.ts';

/**
 * A store and a cache, an api on the store, two sites on the api and
 * a worker on both data nodes, given in start order.
 */
const NODES = [
	{ name: 'store', needs: [] },
	{ name: 'cache', needs: [] },
	{ name: 'api', needs: ['store'] },
	{ name: 'site', needs: ['api'] },
	{ name: 'docs', needs: ['api'] },
	{ name: 'worker', needs: ['store', 'cache'] },
];

const graph = dependencyGraph(NODES);

describe('dependencyGraph', () => {
	test('keeps the nodes as given and finds one by name', () => {
		expect(graph.nodes).toEqual(NODES);
		expect(graph.node('api')).toBe(NODES[2]!);
	});

	test('the closure is the names and all they need, however far, in node order', () => {
		expect(graph.closure(['site'])).toEqual(['store', 'api', 'site']);
		expect(graph.closure(['docs', 'worker'])).toEqual([
			'store',
			'cache',
			'api',
			'docs',
			'worker',
		]);
		expect(graph.closure([])).toEqual([]);
	});

	test('the dependents are all that need a name, however far, in node order', () => {
		expect(graph.dependents('store')).toEqual([
			'api',
			'site',
			'docs',
			'worker',
		]);
		expect(graph.dependents('api')).toEqual(['site', 'docs']);
		expect(graph.dependents('site')).toEqual([]);
	});

	test('downstream is the names and all that need them, in node order', () => {
		expect(graph.downstream(['site', 'cache'])).toEqual([
			'cache',
			'site',
			'worker',
		]);
		expect(graph.downstream(['api'])).toEqual(['api', 'site', 'docs']);
	});

	test('a cycle closes without looping', () => {
		const looped = dependencyGraph([
			{ name: 'a', needs: ['b'] },
			{ name: 'b', needs: ['a'] },
		]);
		expect(looped.closure(['a'])).toEqual(['a', 'b']);
		expect(looped.dependents('a')).toEqual(['a', 'b']);
	});

	test('refuses a name it lacks, naming them all', () => {
		for (const call of [
			() => graph.node('nope'),
			() => graph.closure(['nope']),
			() => graph.dependents('nope'),
			() => graph.downstream(['nope']),
		])
			expect(call).toThrow(
				new Refusal(
					'nope is not known; the names are store, cache, api, site, docs, worker',
				),
			);
	});

	test('a need naming no node is refused once the closure reaches it', () => {
		const broken = dependencyGraph([{ name: 'a', needs: ['gone'] }]);
		expect(() => broken.closure(['a'])).toThrow(Refusal);
	});

	test('throws what `unknown` builds for a name it lacks', () => {
		const named = dependencyGraph(NODES, {
			unknown: (name, names) =>
				new Refusal(`${name} is not a unit; the units are ${names[0]}`),
		});
		expect(() => named.node('nope')).toThrow(
			'nope is not a unit; the units are store',
		);
	});
});

describe('pullingNeeds and pullingDependents', () => {
	test('name what holds an item, one by name and more as them', () => {
		const needs = pullingNeeds(graph);
		expect(needs.heldNotice('store', ['api'])).toBe(
			'api needs store; uncheck api first',
		);
		expect(needs.heldNotice('api', ['site', 'docs'])).toBe(
			'site, docs need api; uncheck them first',
		);
		const dependents = pullingDependents(graph);
		expect(dependents.heldNotice('site', ['store', 'api'])).toBe(
			'site needs store, api; uncheck them first',
		);
	});

	test('pull and hold over the graph', () => {
		const needs = pullingNeeds(graph);
		expect(needs.pull('site')).toEqual(['store', 'api', 'site']);
		expect(needs.holds('api', new Set(['docs', 'store']))).toEqual([
			'docs',
		]);
		const dependents = pullingDependents(graph);
		expect(dependents.pull('api')).toEqual(['api', 'site', 'docs']);
		expect(
			dependents.holds('site', new Set(['store', 'docs'])),
		).toEqual(['store']);
	});
});
