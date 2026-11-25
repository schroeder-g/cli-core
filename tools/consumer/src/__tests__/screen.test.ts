import { expect, test } from 'bun:test';
import { join } from 'node:path';

/** The modules an import of `entry` loads, as a fresh process sees them. */
const loadedBy = (entry: string): string[] => {
	const loaded = Bun.spawnSync(
		[
			'bun',
			'-e',
			`await import('${entry}'); console.log(JSON.stringify(Object.keys(require.cache)));`,
		],
		{
			cwd: join(import.meta.dir, '..', '..'),
			env: { PATH: process.env.PATH },
		},
	);
	return JSON.parse(loaded.stdout.toString());
};

test.each([
	['@four7/cli-core', '/dist/index.js'],
	['@four7/cli-core/screen', '/dist/ui/screen.js'],
])(
	'%s loads no Ink, React or view until a view opens',
	(entry, file) => {
		const modules = loadedBy(entry);
		expect(modules.some(path => path.endsWith(file))).toBe(true);
		expect(
			modules.filter(
				path =>
					/node_modules\/(\.pnpm\/)?(ink|react)[@/]/.test(path)
					|| /\/dist\/ui\/(index|ChecklistView|LogViewer|ScreenFrame)\.js$/.test(
						path,
					),
			),
		).toEqual([]);
	},
);
