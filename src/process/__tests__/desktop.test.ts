import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Failure } from '../../core/errors.ts';
import { stubTools } from '../../testing/index.ts';
import { copyToClipboard, openUrl } from '../desktop.ts';

const URL = 'https://example.com/a?b=1&c=2';

const TEXT = 'https://abc.trycloudflare.com\n';

const KEEP = (tool: string) => `/bin/cat > "$STUB_DIR/${tool}.out"`;

const stubs = stubTools({});

beforeEach(() => {
	stubs.only();
});

const copied = (tool: string): string =>
	readFileSync(join(stubs.dir, `${tool}.out`), 'utf8');

describe('openUrl', () => {
	test('opens the url with what the platform opens it with', async () => {
		for (const tool of ['open', 'xdg-open', 'cmd'])
			stubs.stub(tool, '');
		await openUrl(URL, { platform: 'darwin' });
		await openUrl(URL, { platform: 'linux' });
		await openUrl(URL, { platform: 'freebsd' });
		await openUrl(URL, { platform: 'win32' });
		expect(stubs.calls()).toEqual([
			`open ${URL}`,
			`xdg-open ${URL}`,
			`xdg-open ${URL}`,
			'cmd /c start  https://example.com/a?b=1^&c=2',
		]);
	});

	test('fails naming an opener that is missing or fails', async () => {
		await expect(openUrl(URL, { platform: 'linux' })).rejects.toThrow(
			new Failure('xdg-open could not start: not found on PATH'),
		);
		stubs.stub('xdg-open', 'echo "no browser" >&2; exit 3');
		await expect(openUrl(URL, { platform: 'linux' })).rejects.toThrow(
			new Failure('xdg-open exited 3: no browser'),
		);
	});
});

describe('copyToClipboard', () => {
	test("puts the text on macOS's and Windows' clipboards", async () => {
		stubs.stub('pbcopy', KEEP('pbcopy'));
		stubs.stub('clip', KEEP('clip'));
		await copyToClipboard(TEXT, { platform: 'darwin' });
		await copyToClipboard(TEXT, { platform: 'win32' });
		expect(copied('pbcopy')).toBe(TEXT);
		expect(copied('clip')).toBe(TEXT);
	});

	test('on Linux, takes wl-copy under Wayland and xclip under X', async () => {
		for (const tool of ['wl-copy', 'xclip', 'xsel'])
			stubs.stub(tool, KEEP(tool));
		const wayland = { WAYLAND_DISPLAY: 'wayland-0', PATH: stubs.dir };
		const x11 = { DISPLAY: ':0', PATH: stubs.dir };
		await copyToClipboard(TEXT, { platform: 'linux', env: wayland });
		await copyToClipboard(TEXT, { platform: 'linux', env: x11 });
		expect(stubs.calls()).toEqual([
			'wl-copy ',
			'xclip -selection clipboard',
		]);
		expect(copied('wl-copy')).toBe(TEXT);
		expect(copied('xclip')).toBe(TEXT);
	});

	test('on Linux without wl-copy or xclip, takes xsel', async () => {
		stubs.stub('xsel', KEEP('xsel'));
		await copyToClipboard(TEXT, {
			platform: 'linux',
			env: { WAYLAND_DISPLAY: 'wayland-0', PATH: stubs.dir },
		});
		expect(stubs.calls()).toEqual(['xsel --clipboard --input']);
		expect(copied('xsel')).toBe(TEXT);
	});

	test('fails naming a missing or failing tool', async () => {
		await expect(
			copyToClipboard(TEXT, {
				platform: 'linux',
				env: { PATH: stubs.dir },
			}),
		).rejects.toThrow(
			new Failure('cannot copy: none of xclip, xsel is on PATH'),
		);
		await expect(
			copyToClipboard(TEXT, { platform: 'darwin' }),
		).rejects.toThrow(
			new Failure(
				'cannot copy: pbcopy could not start: not found on PATH',
			),
		);
		stubs.stub('pbcopy', 'echo "no pasteboard" >&2; exit 1');
		await expect(
			copyToClipboard(TEXT, { platform: 'darwin' }),
		).rejects.toThrow(new Failure('pbcopy exited 1: no pasteboard'));
	});
});
