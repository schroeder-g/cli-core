import { log, names, timestamp } from '@four7/cli-core';
import { form } from '@four7/cli-core/builder';
import { findRoot } from '@four7/cli-core/git';
import { runPlan } from '@four7/cli-core/process';
import { hermetic, terminal } from '@four7/cli-core/testing';
import { Title } from '@four7/cli-core/ui';
import { message } from '@optique/core/message';

import { config } from './program.ts';

export const entries = {
	log,
	form,
	runPlan,
	terminal,
	Title,
	findRoot,
};

export const targets = names(['-t', '--target'], () => ['a', 'b'], {
	description: message`The targets.`,
	noun: 'target',
});

export const since = timestamp();

export const loadHermetic = hermetic(config);

export const { context, load, sourceOf } = config;
