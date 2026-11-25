import { describe, expect, test } from 'bun:test';

import { DependencyGate } from '../gate.ts';

const settled = async (promise: Promise<void>) => {
	let state = 'pending';
	promise.then(
		() => {
			state = 'ready';
		},
		(error: unknown) => {
			state = `failed: ${(error as Error).message}`;
		},
	);
	await Bun.sleep(0);
	return state;
};

describe('DependencyGate', () => {
	test('a start waits until every need is ready', async () => {
		const gate = new DependencyGate(['postgres', 'redis', 'api']);
		const waiting = gate.awaitReady(['postgres', 'redis']);
		gate.latch('postgres')?.open();
		expect(await settled(waiting)).toBe('pending');
		gate.latch('redis')?.open();
		expect(await settled(waiting)).toBe('ready');
	});

	test('a need that fails fails the wait at once, with its reason', async () => {
		const gate = new DependencyGate(['postgres', 'redis']);
		const waiting = gate.awaitReady(['postgres', 'redis']);
		gate.latch('redis')?.fail(new Error('redis did not come up'));
		expect(await settled(waiting)).toBe(
			'failed: redis did not come up',
		);
	});

	test('a need the gate was never armed for counts as ready', async () => {
		const gate = new DependencyGate(['api']);
		expect(await settled(gate.awaitReady(['elsewhere']))).toBe('ready');
		expect(await settled(gate.awaitReady([]))).toBe('ready');
	});

	test('arming again starts a fresh wait the last start cannot settle', async () => {
		const gate = new DependencyGate();
		const first = gate.arm('api');
		first.open();
		const second = gate.arm('api');
		expect(gate.latch('api')).toBe(second);
		const waiting = gate.awaitReady(['api']);
		first.fail(new Error('the old start went'));
		expect(await settled(waiting)).toBe('pending');
		second.open();
		expect(await settled(waiting)).toBe('ready');
	});

	test('a latch failed with nobody waiting rejects nothing unhandled', async () => {
		const gate = new DependencyGate(['api']);
		gate.latch('api')?.fail(new Error('went'));
		await Bun.sleep(0);
		expect(await settled(gate.awaitReady(['api']))).toBe(
			'failed: went',
		);
	});
});
