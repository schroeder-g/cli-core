import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');

const PROGRAM = /## A program\n\n```ts\n([\s\S]*?)```\n/;

test("the README's program is the consumer check's, as it runs", () => {
	const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
	const checked = readFileSync(
		join(ROOT, 'tools', 'consumer', 'src', 'nt.ts'),
		'utf8',
	);
	expect(PROGRAM.exec(readme)?.[1]).toBe(checked);
});
