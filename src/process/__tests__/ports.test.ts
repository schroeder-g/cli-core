import { describe, expect, test } from 'bun:test';

import { freePort } from '../../testing/ports.ts';
import { until, waitForPort } from '../ports.ts';

describe('until', () => {
	test('answers false for a wait called off before it began', async () => {
		let checks = 0;
		const off = AbortSignal.abort();
		expect(
			await until(
				() => {
					checks++;
					return false;
				},
				1_000,
				off,
			),
		).toBe(false);
		expect(checks).toBe(0);
	});

	test('answers false for a wait called off while it polls', async () => {
		const off = new AbortController();
		setTimeout(() => off.abort(), 150);
		expect(await until(() => false, 10_000, off.signal)).toBe(false);
	});

	test('waitForPort answers false for a wait already called off', async () => {
		expect(
			await waitForPort(await freePort(), 1_000, AbortSignal.abort()),
		).toBe(false);
	});
});
