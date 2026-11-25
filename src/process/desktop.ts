import { Failure } from '../core/errors.ts';
import type { Environment } from '../core/xdg.ts';
import { capture, SpawnFailure } from './spawn.ts';

/** What `start` takes for a metacharacter in cmd's command line. */
const CMD_ESCAPE = /[&|<>^]/g;

/** The Linux clipboards, in the order a session reaches them. */
const X_CLIPBOARDS: readonly (readonly string[])[] = [
	['xclip', '-selection', 'clipboard'],
	['xsel', '--clipboard', '--input'],
];

const WAYLAND_CLIPBOARD: readonly string[] = ['wl-copy'];

/** @public */
export interface DesktopOptions {
	/** The platform whose tool runs; this machine's by default. */
	readonly platform?: NodeJS.Platform;
	/** Where a Linux tool is looked for and the session read from. */
	readonly env?: Environment;
}

function opener(url: string, platform: NodeJS.Platform): string[] {
	if (platform === 'darwin') return ['open', url];
	// start's first quoted word is a window title, so an empty one goes
	// first; cmd reads `&` and its kin in the url unless escaped.
	if (platform === 'win32')
		return ['cmd', '/c', 'start', '', url.replace(CMD_ESCAPE, '^$&')];
	return ['xdg-open', url];
}

/**
 * Runs `argv` to its end, `input` on its stdin, looked up on `path`
 * when given; a Failure names a tool that cannot start, under
 * `context` when given, or that exits other than 0, with its stderr.
 */
async function finished(
	argv: readonly string[],
	{
		input,
		context,
		path,
	}: {
		readonly input?: string;
		readonly context?: string;
		readonly path?: string;
	} = {},
): Promise<void> {
	const env: Record<string, string> =
		path === undefined ? {} : { PATH: path };
	const { code, stderr } = await capture(argv, { input, env }).catch(
		(error: unknown) => {
			if (!(error instanceof SpawnFailure) || context === undefined)
				throw error;
			throw new Failure(`${context}: ${error.message}`);
		},
	);
	if (code !== 0)
		throw new Failure(`${argv[0]} exited ${code}: ${stderr.trim()}`);
}

/**
 * Opens `url` in the desktop's browser: `open` on macOS, `start` on
 * Windows, `xdg-open` elsewhere. A Failure names an opener that cannot
 * start or that fails.
 *
 * @public
 */
export const openUrl = (
	url: string,
	{ platform = process.platform }: DesktopOptions = {},
): Promise<void> => finished(opener(url, platform));

/** The Linux clipboard tool on PATH, Wayland's first under Wayland. */
function linuxClipboard(env: Environment): readonly string[] {
	const candidates = [
		...(env.WAYLAND_DISPLAY ? [WAYLAND_CLIPBOARD] : []),
		...X_CLIPBOARDS,
	];
	const found = candidates.find(
		([tool]) => Bun.which(tool!, { PATH: env.PATH ?? '' }) !== null,
	);
	if (found !== undefined) return found;
	throw new Failure(
		`cannot copy: none of ${candidates.map(([tool]) => tool).join(', ')} is on PATH`,
	);
}

/**
 * Puts `text` on the clipboard: `pbcopy` on macOS, `clip` on Windows,
 * and on Linux `wl-copy` under Wayland, else `xclip` or `xsel`. A
 * Failure names a tool that is missing or that fails.
 *
 * @public
 */
export async function copyToClipboard(
	text: string,
	{
		platform = process.platform,
		env = process.env,
	}: DesktopOptions = {},
): Promise<void> {
	const argv =
		platform === 'darwin'
			? ['pbcopy']
			: platform === 'win32'
				? ['clip']
				: linuxClipboard(env);
	await finished(argv, {
		input: text,
		context: 'cannot copy',
		path: env.PATH,
	});
}
