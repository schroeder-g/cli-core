import { log } from '@four7/cli-core';
import { form } from '@four7/cli-core/builder';
import { findRoot } from '@four7/cli-core/git';
import { runPlan } from '@four7/cli-core/process';
import { terminal } from '@four7/cli-core/testing';
import { Title } from '@four7/cli-core/ui';

import { config } from './program.ts';

export const entries = {
	log,
	form,
	runPlan,
	terminal,
	Title,
	findRoot,
};

export const { context, load, sourceOf } = config;
