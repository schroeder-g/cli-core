import { describe, it } from 'node:test';

import { RuleTester } from 'oxlint/plugins-dev';

import plugin from '../four7.mts';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: { parserOptions: { lang: 'tsx' } },
});

const lines = (...rows: string[]) => rows.join('\n');

tester.run('constants-first', plugin.rules['constants-first'], {
	valid: [
		lines(
			"'use client';",
			"import { a } from 'a';",
			'type Row = { id: string };',
			'export const PAGE_SIZE = 10;',
			'const MAX_ROWS: Row[] = [];',
			'export function list() {',
			'\tconst LIMIT = 5;',
			'\tconst rows = MAX_ROWS.slice(0, LIMIT);',
			'\treturn rows;',
			'}',
		),
		lines('const rows = load();', 'const total = rows.length;'),
		lines('const rows = load();', 'const { A, B } = rows;'),
		lines('const n = read();', 'const N = parse(n);'),
		lines('const rows = load();', 'const RENDER = () => rows;'),
		lines(
			'const keyed = () => 1;',
			'class Members {}',
			'const HOSTS = new Members(keyed());',
		),
	],
	invalid: [
		{
			code: lines('const rows = load();', 'const PAGE_SIZE = 10;'),
			errors: [
				{
					messageId: 'notFirst',
					line: 2,
					suggestions: [
						{
							messageId: 'moveUp',
							output: lines(
								'const PAGE_SIZE = 10;',
								'',
								'const rows = load();',
							),
						},
					],
				},
			],
		},
		{
			code: lines(
				'export function list() {',
				'\tif (!ready) return;',
				'\t// how many to list',
				'\tconst LIMIT = 5;',
				'}',
			),
			errors: [
				{
					messageId: 'notFirst',
					line: 4,
					suggestions: [
						{
							messageId: 'moveUp',
							output: lines(
								'export function list() {',
								'\t// how many to list',
								'\tconst LIMIT = 5;',
								'',
								'\tif (!ready) return;',
								'}',
							),
						},
					],
				},
			],
		},
		{
			code: lines(
				'const keyed = () => 1;',
				'function helper() {}',
				'const HOSTS = keyed();',
			),
			errors: [
				{
					messageId: 'notFirst',
					line: 3,
					suggestions: [
						{
							messageId: 'moveUp',
							output: lines(
								'const keyed = () => 1;',
								'',
								'const HOSTS = keyed();',
								'function helper() {}',
							),
						},
					],
				},
			],
		},
		{
			code: lines(
				"import { a } from 'a';",
				'',
				'function helper() {}',
				'',
				'export const PAGE_SIZE = 10;',
			),
			errors: [
				{
					messageId: 'notFirst',
					line: 5,
					suggestions: [
						{
							messageId: 'moveUp',
							output: lines(
								"import { a } from 'a';",
								'',
								'export const PAGE_SIZE = 10;',
								'',
								'function helper() {}',
								'',
							),
						},
					],
				},
			],
		},
	],
});

tester.run('padded-declarations', plugin.rules['padded-declarations'], {
	valid: [
		lines(
			"import { a } from 'a';",
			'',
			'type Row = { id: string };',
			'',
			'export interface Props {',
			'\trow: Row;',
			'}',
			'',
			'enum Mode {',
			'\tLight,',
			'}',
			'',
			'function f() {}',
			'',
			'export const g = () => 1;',
			'',
			'export default class Store {}',
			'',
			'const Lazy = class {};',
			'',
			'const x = a;',
		),
		lines(
			'const x = 1;',
			'',
			'/** A documented row. */',
			'type Row = { id: string };',
		),
		lines('function f() {', '\ttype Local = string;', '}'),
		lines(
			'const f = () => {',
			'\tconst g = () => 1;',
			'',
			'\treturn g;',
			'};',
		),
		lines('const value = compute();', 'const other = 2;'),
	],
	invalid: [
		{
			code: lines('const x = 1;', 'type Row = { id: string };'),
			output: lines('const x = 1;', '', 'type Row = { id: string };'),
			errors: [{ messageId: 'above', line: 2 }],
		},
		{
			code: lines('type Row = { id: string };', 'const x = 1;'),
			output: lines('type Row = { id: string };', '', 'const x = 1;'),
			errors: [{ messageId: 'below', line: 1 }],
		},
		{
			code: lines(
				'const x = 1; // trailing',
				'/** A documented row. */',
				'export interface Row {',
				'\tid: string;',
				'}',
				'enum Mode {',
				'\tLight,',
				'}',
			),
			output: lines(
				'const x = 1; // trailing',
				'',
				'/** A documented row. */',
				'export interface Row {',
				'\tid: string;',
				'}',
				'',
				'enum Mode {',
				'\tLight,',
				'}',
			),
			errors: [
				{ messageId: 'above', line: 3 },
				{ messageId: 'below', line: 3 },
				{ messageId: 'above', line: 6 },
			],
		},
		{
			code: lines('const x = 1;', 'function a() {}', 'const y = 2;'),
			output: lines(
				'const x = 1;',
				'',
				'function a() {}',
				'',
				'const y = 2;',
			),
			errors: [
				{ messageId: 'above', line: 2 },
				{ messageId: 'below', line: 2 },
			],
		},
		{
			code: lines(
				'export const b = (n: number) => n;',
				'const c = function () {};',
			),
			output: lines(
				'export const b = (n: number) => n;',
				'',
				'const c = function () {};',
			),
			errors: [
				{ messageId: 'below', line: 1 },
				{ messageId: 'above', line: 2 },
			],
		},
		{
			code: lines(
				'const x = 1;',
				'export class Store {}',
				'const Lazy = class {};',
				'x();',
			),
			output: lines(
				'const x = 1;',
				'',
				'export class Store {}',
				'',
				'const Lazy = class {};',
				'',
				'x();',
			),
			errors: [
				{ messageId: 'above', line: 2 },
				{ messageId: 'below', line: 2 },
				{ messageId: 'above', line: 3 },
				{ messageId: 'below', line: 3 },
			],
		},
	],
});

tester.run('tests-in-tests-dir', plugin.rules['tests-in-tests-dir'], {
	valid: [
		{
			code: 'it();',
			filename: 'packages/hosts/src/__tests__/hosts.test.ts',
		},
		{
			code: 'it();',
			filename: 'tools/lint/__tests__/four7.test.mts',
		},
		{
			code: 'it();',
			filename: 'infra/provision/src/__tests__/gcp/onboarding.spec.tsx',
		},
		{
			code: 'export const hosts = [];',
			filename: 'packages/hosts/src/hosts.ts',
		},
		{
			code: 'export const mock = {};',
			filename: 'infra/provision/src/testing/mocks.ts',
		},
		{
			code: 'export const latest = 1;',
			filename: 'packages/sites/src/latest.test-data.ts',
		},
	],
	invalid: [
		{
			code: 'it();',
			filename: 'packages/hosts/src/hosts.test.ts',
			errors: [
				{
					messageId: 'beside',
					line: 1,
					data: {
						name: 'hosts.test.ts',
						path: 'packages/hosts/src/__tests__/hosts.test.ts',
					},
				},
			],
		},
		{
			code: 'it();',
			filename: 'packages/i18n/src/hook.spec.tsx',
			errors: [{ messageId: 'beside' }],
		},
		{
			code: 'it();',
			filename: 'tools/lint/four7.test.mts',
			errors: [{ messageId: 'beside' }],
		},
		{
			code: 'it();',
			filename: 'apps/api/src/tests/routes.test.js',
			errors: [{ messageId: 'beside' }],
		},
	],
});
