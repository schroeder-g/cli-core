import { describe, expect, test } from 'bun:test';

import { Text, useInput } from 'ink';
import type { ReactNode } from 'react';

import { capture, drive, open, shown } from '../../testing/index.ts';
import type { Exit } from '../../ui/screen.ts';
import { defineConfig, z } from '../config.ts';
import { commands } from '../program.ts';

interface ProbeProps {
	readonly label: string;
	readonly onKey: (key: string) => void;
}

/** A program's own view: its label, and each key it reads handed on. */
function Probe({ label, onKey }: ProbeProps): ReactNode {
	useInput(input => onKey(input));
	return <Text>{label}</Text>;
}

const config = defineConfig({
	name: 'probe',
	envPrefix: 'PROBE_',
	schema: z.strictObject({}).prefault({}),
	variables: {},
});

const { present } = commands(config, {
	views: { probe: () => Promise.resolve(Probe) },
}).over();

describe("a program's views", () => {
	test('presents a view it registered by its name', async () => {
		const { result, screen } = await drive(
			open((stdin, stdout) =>
				present({
					io: { stdin, stdout, stderr: capture() },
					refusal: 'needs a terminal',
					view: 'probe',
					props: (exit: Exit<string>) => ({
						label: 'probing',
						onKey: key => exit.done(key),
					}),
				}),
			),
			[shown('probing', 'y')],
		);
		expect(screen).toContain('probing');
		expect(result).toBe('y');
	});

	test("presents cli-core's own views by theirs, beside it", async () => {
		const { result, screen } = await drive(
			open((stdin, stdout) =>
				present({
					io: { stdin, stdout, stderr: capture() },
					refusal: 'needs a terminal',
					view: 'checklistView',
					props: (exit: Exit<ReadonlySet<string>>) => ({
						title: 'chores',
						items: [{ name: 'dishes' }],
						initial: () => new Set<string>(),
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

	test("refuses a name the registry lacks, props that disagree with the view's component, and a program's view under a name cli-core holds", () => {
		const io = {
			stdin: process.stdin,
			stdout: capture(),
			stderr: capture(),
		};

		const refused = () => [
			present({
				io,
				refusal: 'needs a terminal',
				// @ts-expect-error no view is registered as `nope`
				view: 'nope',
				props: () => ({ label: 'probing', onKey: () => undefined }),
			}),
			present({
				io,
				refusal: 'needs a terminal',
				view: 'probe',
				// @ts-expect-error a label is a string
				props: () => ({ label: 1, onKey: () => undefined }),
			}),
			commands(config, {
				// @ts-expect-error cli-core's checklist holds the name
				views: { checklistView: () => Promise.resolve(Probe) },
			}),
		];

		expect(refused).toBeFunction();
	});
});
