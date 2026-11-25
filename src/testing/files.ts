import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Writes `text` at `path` under `root`, its directories made. */
export function writeUnder(
	root: string,
	path: string,
	text: string,
): void {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
}
