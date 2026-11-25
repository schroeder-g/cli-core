import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('/screen loads no Ink, React or view until a view opens', () => {
	const loaded = Bun.spawnSync(
		[
			'bun',
			'-e',
			"await import('@four7/cli-core/screen'); console.log(JSON.stringify(Object.keys(require.cache)));",
		],
		{
			cwd: join(import.meta.dir, '..', '..'),
			env: { PATH: process.env.PATH },
		},
	);
	const modules: string[] = JSON.parse(loaded.stdout.toString());
	expect(
		modules.some(path => path.endsWith('/dist/ui/screen.js')),
	).toBe(true);
	expect(
		modules.filter(
			path =>
				/node_modules\/(\.pnpm\/)?(ink|react)[@/]/.test(path)
				|| /\/dist\/ui\/(index|ChecklistView|LogViewer|ScreenFrame)\.js$/.test(
					path,
				),
		),
	).toEqual([]);
});
