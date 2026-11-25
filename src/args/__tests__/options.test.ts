import { describe, expect, test } from 'bun:test';

import { Refusal } from '../../core/errors.ts';
import {
	formatMessage,
	message,
	nameList,
	names,
	object,
	option,
	parse,
	selectNamed,
	selectOne,
	suggest,
	timestamp,
} from '../index.ts';
import type { Parser } from '../index.ts';

const KNOWN = ['api', 'web', 'portfolio'];

const FLAGS = ['-s', '--service', '--services'] as const;

const plain = { colors: false, quotes: false };

const known = () => KNOWN;

const loose = object({
	s: names(FLAGS, known, {
		description: message`The services.`,
		noun: 'service',
	}),
});

const strict = object({
	s: names(FLAGS, known, {
		description: message`The services.`,
		noun: 'service',
		strict: true,
	}),
});

const parsed = async (
	argv: readonly string[],
	parser: Parser<'sync', { readonly s: unknown }, unknown> = loose,
) => {
	const result = await parse(parser, argv);
	if (!result.success)
		throw new Error(formatMessage(result.error, plain));
	return result.value.s;
};

const refusal = async (
	parser: Parser<'sync', unknown, unknown>,
	argv: readonly string[],
): Promise<string> => {
	const result = await parse(parser, argv);
	if (result.success)
		throw new Error(
			`${argv.join(' ')} parsed as ${JSON.stringify(result.value)}`,
		);
	return formatMessage(result.error, plain);
};

const offered = async (
	parser: Parser<'sync', unknown, unknown>,
	argv: readonly [string, ...string[]],
) =>
	(await suggest(parser, argv)).map(suggestion =>
		suggestion.kind === 'literal' ? suggestion.text : suggestion.kind,
	);

const thrown = (run: () => unknown): Refusal => {
	try {
		run();
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error('nothing was refused');
};

describe('names', () => {
	test('comma-separated, repeated or mixed, in the order written', async () => {
		for (const argv of [
			['-s', 'api,web'],
			['-s', 'api', '-s', 'web'],
			['--services', 'api', '--service', 'web'],
			['-s', ' api , web '],
		])
			expect(await parsed(argv)).toEqual(['api', 'web']);
		expect(await parsed(['-s', 'web,api'])).toEqual(['web', 'api']);
	});

	test('none named is undefined, never an empty list', async () => {
		expect(await parsed([])).toBeUndefined();
	});

	test('refuses a blank element', async () => {
		for (const input of ['api,', ',', '']) {
			const text = await refusal(loose, ['-s', input]);
			expect(text).toBe(
				`-s/--service/--services: Expected comma-separated service names, but got ${input}.`,
			);
		}
	});

	test('strict refuses every name outside the known ones at the parse', async () => {
		expect(await refusal(strict, ['-s', 'api,cli'])).toBe(
			'-s/--service/--services: cli is no service; the services are api, web, portfolio.',
		);
		expect(await refusal(strict, ['-s', 'cli,api,bin,cli'])).toContain(
			'cli, bin are no services; the services are api, web, portfolio.',
		);
		expect(await parsed(['-s', 'api,web'], strict)).toEqual([
			'api',
			'web',
		]);
	});

	test('quotes the names refused, not the known ones', async () => {
		const result = await parse(strict, ['-s', 'cli,bin']);
		if (result.success) throw new Error('cli,bin parsed');
		expect(formatMessage(result.error, { colors: false })).toBe(
			'`-s`/`--service`/`--services`: "cli", "bin" are no services; the services are api, web, portfolio.',
		);
	});

	test('loose takes a name outside the known ones', async () => {
		expect(await parsed(['-s', 'cli'])).toEqual(['cli']);
	});

	test('completes the partial after the last separator, the named ones left out', async () => {
		expect(await offered(loose, ['-s', ''])).toEqual(KNOWN);
		expect(await offered(loose, ['-s', 'api,'])).toEqual([
			'api,web',
			'api,portfolio',
		]);
		expect(await offered(loose, ['-s', 'api,p'])).toEqual([
			'api,portfolio',
		]);
		expect(await offered(loose, ['-s', 'api', '-s', ''])).toEqual([
			'web',
			'portfolio',
		]);
	});
});

describe('nameList', () => {
	test('takes its metavar, noun, plural and separator', async () => {
		const list = nameList(known, {
			metavar: 'CHILDREN',
			noun: 'child',
			plural: 'children',
			separator: ';',
			strict: true,
		});
		const parser = object({ c: option('-c', list) });
		expect(list.metavar).toBe('CHILDREN');
		expect(list.format(['api', 'web'])).toBe('api;web');
		expect(await refusal(parser, ['-c', 'api;'])).toBe(
			'-c: Expected child names separated by ";", but got api;.',
		);
		expect(await refusal(parser, ['-c', 'api;kid'])).toBe(
			'-c: kid is no child; the children are api, web, portfolio.',
		);
		expect(await offered(parser, ['-c', 'api;w'])).toEqual(['api;web']);
	});

	test('chooses among the known names, one list each, and none when nothing is known', () => {
		expect(nameList(known).choices).toEqual([
			['api'],
			['web'],
			['portfolio'],
		]);
		expect(nameList(() => []).choices).toBeUndefined();
	});

	test('a source that throws knows nothing, and help still reads its choices', async () => {
		const list = nameList(() => {
			throw new Error('no checkout');
		});
		expect(list.choices).toBeUndefined();
		expect(
			await offered(object({ s: option('-s', list) }), ['-s', '']),
		).toEqual([]);
	});

	test('reads its source once, when first asked', () => {
		let reads = 0;
		const list = nameList(() => {
			reads += 1;
			return KNOWN;
		});
		expect(reads).toBe(0);
		void list.choices;
		void list.choices;
		list.parse('api');
		expect(reads).toBe(1);
	});

	test('strict over nothing known says there is none', async () => {
		const parser = object({
			s: option(
				'-s',
				nameList(() => [], { strict: true }),
			),
		});
		expect(await refusal(parser, ['-s', 'api'])).toBe(
			'-s: api is no name; there are no names.',
		);
	});
});

describe('selectNamed', () => {
	const ORDER = ['api', 'web', 'portfolio'];

	const APP = { noun: 'app' };

	test('is every item, in order, when nothing is named', () => {
		expect(selectNamed(ORDER, undefined, APP)).toEqual(ORDER);
		expect(selectNamed(ORDER, [], APP)).toEqual(ORDER);
	});

	test('keeps the items’ order, not the names’, each once and trimmed', () => {
		expect(selectNamed(ORDER, ['portfolio', ' api '], APP)).toEqual([
			'api',
			'portfolio',
		]);
		expect(selectNamed(ORDER, ['api', 'api'], APP)).toEqual(['api']);
	});

	test('names every unknown name at once, and the known ones', () => {
		expect(
			thrown(() => selectNamed(ORDER, ['nope'], APP)).message,
		).toBe('nope is no app; the apps are api, web, portfolio');
		expect(
			thrown(() =>
				selectNamed(ORDER, ['nope', 'api', 'bogus', 'nope'], APP),
			).message,
		).toBe('nope, bogus are no apps; the apps are api, web, portfolio');
	});

	test('refuses a blank name before any unknown one', () => {
		for (const named of [['nope', ''], [' ']])
			expect(thrown(() => selectNamed(ORDER, named, APP)).message).toBe(
				'a blank name is no app; the apps are api, web, portfolio',
			);
	});

	test('reads each item’s name, and takes a plural', () => {
		const checks = [{ slug: 'lint' }, { slug: 'knip' }];

		const select = (named: readonly string[]) =>
			selectNamed(checks, named, {
				noun: 'check',
				nameOf: check => check.slug,
			});

		expect(select(['knip'])).toEqual([{ slug: 'knip' }]);
		expect(thrown(() => select(['fmt'])).message).toBe(
			'fmt is no check; the checks are lint, knip',
		);
		expect(
			thrown(() =>
				selectNamed(['x'], ['y'], {
					noun: 'child',
					plural: 'children',
				}),
			).message,
		).toBe('y is no child; the children are x');
	});
});

describe('selectOne', () => {
	const ORDER = ['api', 'web'];

	const ONE = { noun: 'service', verb: 'bounce' };

	test('is the one item named, or none when nothing is', () => {
		expect(selectOne(ORDER, ['web'], ONE)).toBe('web');
		expect(selectOne(ORDER, undefined, ONE)).toBeUndefined();
	});

	test('refuses several names, by the verb that takes one', () => {
		expect(
			thrown(() => selectOne(ORDER, ['api', 'web'], ONE)).message,
		).toBe('bounce takes one service at a time; got api, web');
	});

	test('refuses an unknown name as selectNamed does', () => {
		expect(thrown(() => selectOne(ORDER, ['nope'], ONE)).message).toBe(
			'nope is no service; the services are api, web',
		);
	});
});

describe('timestamp', () => {
	const NOW = Date.parse('2026-10-24T10:00:00Z');

	const since = object({
		t: option('--since', timestamp({ now: () => NOW })),
	});

	const at = async (input: string) => {
		const result = await parse(since, ['--since', input]);
		if (!result.success)
			throw new Error(formatMessage(result.error, plain));
		return result.value.t;
	};

	test('a duration reads back from now', async () => {
		expect(await at('30s')).toEqual(new Date(NOW - 30_000));
		expect(await at('30m')).toEqual(new Date(NOW - 30 * 60_000));
		expect(await at('2h')).toEqual(new Date(NOW - 2 * 3_600_000));
		expect(await at('1d')).toEqual(new Date(NOW - 86_400_000));
	});

	test('an ISO time is that time', async () => {
		expect(await at('2026-11-01T00:00:00Z')).toEqual(
			new Date('2026-11-01T00:00:00Z'),
		);
		expect(await at('2026-11-01')).toEqual(new Date('2026-11-01'));
		expect(await at('2026-11-01T09:30+02:00')).toEqual(
			new Date('2026-11-01T07:30:00Z'),
		);
	});

	test('refuses anything else', async () => {
		for (const input of [
			'yesterday',
			'10',
			'5y',
			'',
			'Nov 1 2026',
			'2026-13-01',
		])
			expect(await refusal(since, ['--since', input])).toBe(
				`--since: Expected a duration back from now (30m, 2h, 1d) or an ISO time, but got ${input}.`,
			);
	});

	test('reads now when it parses, and formats as an ISO time', () => {
		const parser = timestamp();
		const before = Date.now();
		const result = parser.parse('1m');
		if (!result.success) throw new Error('1m did not parse');
		expect(result.value.getTime()).toBeGreaterThanOrEqual(
			before - 60_000,
		);
		expect(parser.metavar).toBe('TIME');
		expect(parser.format(new Date(NOW))).toBe(
			'2026-10-24T10:00:00.000Z',
		);
	});
});
