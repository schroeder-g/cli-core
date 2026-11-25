import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { Text, useInput } from 'ink';
import type { ReactNode } from 'react';

import { capture, drive, open, shown } from '../../testing/index.ts';
import type { Step } from '../../testing/index.ts';
import { checklistView, presentView } from '../screen.ts';
import type { Exit } from '../screen.ts';

const CTRL_C = '\u0003';

interface ProbeProps {
	readonly label: string;
	readonly onKey: (key: string) => void;
}

/** A program's own view: its label, and each key it reads handed on. */
function Probe({ label, onKey }: ProbeProps): ReactNode {
	useInput(input => onKey(input));
	return <Text>{label}</Text>;
}

const probe = () => Promise.resolve(Probe);

/** Draws `Probe` on a fake terminal, `onKey` ending it through `exit`. */
const probed = <T,>(
	steps: readonly Step[],
	onKey: (exit: Exit<T>, key: string) => void,
) =>
	drive(
		open((stdin, stdout) =>
			presentView({
				io: { stdin, stdout, stderr: capture() },
				refusal: 'needs a terminal',
				view: probe,
				props: (exit: Exit<T>) => ({
					label: 'probing',
					onKey: key => onKey(exit, key),
				}),
			}),
		),
		steps,
	);

describe('presentView', () => {
	test('draws a pre-wrapped view of cli-core, ending with what it confirmed', async () => {
		const { result, screen } = await drive(
			open((stdin, stdout): Promise<ReadonlySet<string> | undefined> =>
				presentView({
					io: { stdin, stdout, stderr: capture() },
					refusal: 'needs a terminal',
					view: checklistView,
					props: exit => ({
						title: 'chores',
						items: [{ name: 'dishes' }, { name: 'laundry' }],
						initial: () => new Set(),
						onQuit: () => exit.interrupt(),
						onConfirm: checked => {
							exit.done(checked);
							return undefined;
						},
					}),
				}),
			),
			[shown('▸ [ ] dishes', ' '), shown('▸ [x] dishes', '\r')],
		);
		expect(screen).toContain('chores');
		expect(result).toEqual(new Set(['dishes']));
	});

	test("draws a program's own view, ending through exit.done", async () => {
		const { result, screen } = await probed<string>(
			[shown('probing', 'y')],
			(exit, key) => exit.done(key),
		);
		expect(screen).toContain('probing');
		expect(result).toBe('y');
	});

	test('rejects with what the view failed with through exit.fail', async () => {
		const failed = probed<never>([shown('probing', 'y')], exit =>
			exit.fail(new Error('the probe broke')),
		);
		await expect(failed).rejects.toThrow('the probe broke');
	});

	test('answers undefined on an interrupt, raised again as SIGINT', async () => {
		const raised = new Promise<void>(resolve => {
			process.once('SIGINT', () => resolve());
		});
		const { result } = await probed<string>(
			[shown('probing', CTRL_C)],
			(exit, key) => exit.done(key),
		);
		expect(result).toBeUndefined();
		await raised;
	});

	test("refuses props that disagree with the view's component", () => {
		const io = {
			stdin: process.stdin,
			stdout: capture(),
			stderr: capture(),
		};

		const mismatched = () => [
			presentView({
				io,
				refusal: 'needs a terminal',
				view: probe,
				// @ts-expect-error a label is a string
				props: () => ({ label: 1, onKey: () => undefined }),
			}),
			presentView({
				io,
				refusal: 'needs a terminal',
				view: checklistView,
				// @ts-expect-error a checklist has a title
				props: () => ({
					items: [],
					initial: (): ReadonlySet<string> => new Set(),
					onQuit: () => undefined,
					onConfirm: () => undefined,
				}),
			}),
		];

		expect(mismatched).toBeFunction();
	});

	test('loads no Ink, React or view of its own until a view opens', () => {
		const loaded = Bun.spawnSync(
			[
				'bun',
				'-e',
				`await import(${JSON.stringify(join(import.meta.dir, '..', 'screen.ts'))});
				console.log(JSON.stringify(Object.keys(require.cache)));`,
			],
			{ env: { PATH: process.env.PATH } },
		);
		const modules: string[] = JSON.parse(loaded.stdout.toString());
		expect(
			modules.filter(path => /node_modules\/(ink|react)\//.test(path)),
		).toEqual([]);
		expect(
			modules.filter(
				path => path.endsWith('.tsx') || path.endsWith('/ui/index.ts'),
			),
		).toEqual([]);
	});
});
