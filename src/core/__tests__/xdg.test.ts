import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';

import { xdgHome } from '../config.ts';

const HOME = '/home/ada';

describe('xdgHome', () => {
	test('is the variable that names the base directory', () => {
		const env = {
			HOME,
			XDG_CONFIG_HOME: '/etc/ada',
			XDG_STATE_HOME: '/var/lib/ada',
			XDG_DATA_HOME: '/srv/ada',
			XDG_CACHE_HOME: '/tmp/ada',
		};
		expect(xdgHome('config', env)).toBe('/etc/ada');
		expect(xdgHome('state', env)).toBe('/var/lib/ada');
		expect(xdgHome('data', env)).toBe('/srv/ada');
		expect(xdgHome('cache', env)).toBe('/tmp/ada');
	});

	test("falls back to the specification's default under HOME", () => {
		expect(xdgHome('config', { HOME })).toBe('/home/ada/.config');
		expect(xdgHome('state', { HOME })).toBe('/home/ada/.local/state');
		expect(xdgHome('data', { HOME })).toBe('/home/ada/.local/share');
		expect(xdgHome('cache', { HOME })).toBe('/home/ada/.cache');
	});

	test('ignores a relative or empty variable, and an empty HOME', () => {
		expect(xdgHome('state', { HOME, XDG_STATE_HOME: 'state' })).toBe(
			'/home/ada/.local/state',
		);
		expect(xdgHome('cache', { HOME, XDG_CACHE_HOME: '' })).toBe(
			'/home/ada/.cache',
		);
		expect(xdgHome('config', { HOME: '' })).toBe(
			`${homedir()}/.config`,
		);
	});
});
