import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	sep,
} from 'node:path';

import type { RuleTester } from 'oxlint/plugins-dev';

type Rule = Parameters<RuleTester['run']>[1];

type Context = Parameters<
	Extract<Rule, { create: unknown }>['create']
>[0];

type Node = any;

const CONSTANT_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const TESTS_DIR = '__tests__';

const TYPE_DECLARATIONS = new Set([
	'TSTypeAliasDeclaration',
	'TSInterfaceDeclaration',
	'TSEnumDeclaration',
]);

/** Every list of statements that forms a scope's body. */
const STATEMENT_LISTS = [
	'Program',
	'BlockStatement',
	'StaticBlock',
	'TSModuleBlock',
];

const TYPE_KINDS: Record<string, string> = {
	TSTypeAliasDeclaration: 'type',
	TSInterfaceDeclaration: 'interface',
	TSEnumDeclaration: 'enum',
	FunctionDeclaration: 'function',
	ClassDeclaration: 'class',
};

const VALUE_KINDS: Record<string, string> = {
	ArrowFunctionExpression: 'function',
	FunctionExpression: 'function',
	ClassExpression: 'class',
};

/** The declaration an export statement wraps, or the statement itself. */
const declarationOf = (statement: Node): Node =>
	(statement.type === 'ExportNamedDeclaration'
		|| statement.type === 'ExportDefaultDeclaration')
	&& statement.declaration
		? statement.declaration
		: statement;

const isConstant = (statement: Node): boolean => {
	const declaration = declarationOf(statement);
	return (
		declaration.type === 'VariableDeclaration'
		&& declaration.kind === 'const'
		&& declaration.declarations.every(
			(declarator: Node) =>
				declarator.id.type === 'Identifier'
				&& declarator.id.name.length > 1
				&& CONSTANT_NAME.test(declarator.id.name)
				&& !VALUE_KINDS[declarator.init?.type],
		)
	);
};

const isTypeDeclaration = (statement: Node): boolean =>
	TYPE_DECLARATIONS.has(declarationOf(statement).type);

/** What a statement declares, when it is padded by blank lines. */
const paddedKindOf = (statement: Node): string | undefined => {
	const declaration = declarationOf(statement);
	if (TYPE_KINDS[declaration.type]) return TYPE_KINDS[declaration.type];
	if (
		declaration.type === 'VariableDeclaration'
		&& declaration.declarations.length === 1
	)
		return VALUE_KINDS[declaration.declarations[0].init?.type];
	return undefined;
};

const isDirective = (statement: Node): boolean =>
	statement.type === 'ExpressionStatement'
	&& typeof statement.directive === 'string';

/** Every identifier a subtree names, its declarations' and its reads'. */
const namesIn = (
	node: Node,
	names = new Set<string>(),
): Set<string> => {
	if (Array.isArray(node)) {
		for (const child of node) namesIn(child, names);
	} else if (node && typeof node === 'object') {
		if (node.type === 'Identifier') names.add(node.name);
		for (const [key, child] of Object.entries(node))
			if (key !== 'parent') namesIn(child, names);
	}
	return names;
};

/** The bindings a statement declares in its scope. */
const namesDeclaredBy = (statement: Node): string[] => {
	const declaration = declarationOf(statement);
	if (declaration.type === 'VariableDeclaration')
		return [
			...namesIn(declaration.declarations.map((d: Node) => d.id)),
		];
	return declaration.id?.type === 'Identifier'
		? [declaration.id.name]
		: [];
};

/** What may stand above a constant in its scope. */
const mayPrecedeConstant = (statement: Node): boolean =>
	isDirective(statement)
	|| statement.type === 'ImportDeclaration'
	|| isTypeDeclaration(statement)
	|| isConstant(statement)
	|| declarationOf(statement).declare === true;

const forEachStatementList = (
	visit: (statements: Node[], context: Context) => void,
) => ({
	create: (context: Context) =>
		Object.fromEntries(
			STATEMENT_LISTS.map(type => [
				type,
				(node: Node) => visit(node.body, context),
			]),
		),
});

/** The first line a statement occupies, its leading comments included. */
const topLine = (context: Context, statement: Node, previous: Node) => {
	const comments = context.sourceCode
		.getCommentsBefore(statement)
		.filter(
			(comment: Node) => comment.loc.start.line > previous.loc.end.line,
		);
	return (comments[0] ?? statement).loc.start.line;
};

/** The offset of the end of the line a node ends on. */
const endOfLine = (context: Context, node: Node): number => {
	const text = context.sourceCode.text;
	const newline = text.indexOf('\n', node.range[1]);
	return newline === -1 ? text.length : newline;
};

const blankLineBetween = (
	context: Context,
	previous: Node,
	next: Node,
): boolean =>
	topLine(context, next, previous) - previous.loc.end.line >= 2;

const requireBlankLine = (
	context: Context,
	previous: Node,
	next: Node,
	messageId: 'above' | 'below',
	kind: string,
) => {
	if (blankLineBetween(context, previous, next)) return;
	context.report({
		node: messageId === 'above' ? next : previous,
		messageId,
		data: { kind },
		fix: fixer =>
			fixer.insertTextAfterRange(
				[endOfLine(context, previous), endOfLine(context, previous)],
				'\n',
			),
	});
};

/** The offset of the start of the line an offset falls on. */
const lineStart = (context: Context, offset: number): number =>
	context.sourceCode.text.lastIndexOf('\n', offset - 1) + 1;

/**
 * Where a statement begins, the comments on the lines above it
 * included.
 */
const topOffset = (
	context: Context,
	statements: Node[],
	index: number,
): number => {
	const statement = statements[index];
	const previous = statements[index - 1];
	const comments = context.sourceCode
		.getCommentsBefore(statement)
		.filter(
			(comment: Node) =>
				!previous || comment.loc.start.line > previous.loc.end.line,
		);
	return (comments[0] ?? statement).range[0];
};

/**
 * Cuts the statement at `index`, with its comments, and reinserts it
 * below the statement at `anchor`, or at the top of the list when no
 * statement anchors it.
 */
const moveBelow = (
	context: Context,
	fixer: any,
	statements: Node[],
	index: number,
	anchor: number,
) => {
	const text = context.sourceCode.text;
	const start = lineStart(
		context,
		topOffset(context, statements, index),
	);
	const end = endOfLine(context, statements[index]);
	const moved = text.slice(start, end);
	const cut =
		text[end] === '\n'
			? fixer.removeRange([start, end + 1])
			: fixer.removeRange([start - 1, end]);
	const paste =
		anchor >= 0
			? fixer.insertTextAfterRange(
					[
						endOfLine(context, statements[anchor]),
						endOfLine(context, statements[anchor]),
					],
					`\n\n${moved}`,
				)
			: fixer.insertTextBeforeRange(
					[
						lineStart(context, topOffset(context, statements, 0)),
						lineStart(context, topOffset(context, statements, 0)),
					],
					`${moved}\n\n`,
				);
	return [cut, paste];
};

const constantsFirst: Rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'An UPPER_SNAKE constant goes as high in its scope as the declarations it reads allow: below them, only directives, imports, type declarations and other constants precede it.',
		},
		hasSuggestions: true,
		messages: {
			notFirst:
				'Constants go at the top of their scope: below the declarations they read, only directives, imports, type declarations and other constants precede them.',
			moveUp:
				'Move the constant below its last dependency or the head of its scope.',
		},
	},
	...forEachStatementList((statements, context) => {
		statements.forEach((statement, index) => {
			if (!isConstant(statement)) return;
			const reads = namesIn(declarationOf(statement).declarations);
			const above = statements.slice(0, index);
			const lastDependency = above.findLastIndex(earlier =>
				namesDeclaredBy(earlier).some(name => reads.has(name)),
			);
			if (
				!above
					.slice(lastDependency + 1)
					.some(earlier => !mayPrecedeConstant(earlier))
			)
				return;
			const head = statements.findIndex(
				earlier => !mayPrecedeConstant(earlier),
			);
			context.report({
				node: statement,
				messageId: 'notFirst',
				suggest: [
					{
						messageId: 'moveUp',
						fix: fixer =>
							moveBelow(
								context,
								fixer,
								statements,
								index,
								Math.max(lastDependency, head - 1),
							),
					},
				],
			});
		});
	}),
};

const paddedDeclarations: Rule = {
	meta: {
		type: 'layout',
		fixable: 'whitespace',
		docs: {
			description:
				'A type alias, interface, enum, function or class, declared or bound to a name, has a blank line above and below it.',
		},
		messages: {
			above: 'A {{kind}} has a blank line above it.',
			below: 'A {{kind}} has a blank line below it.',
		},
	},
	...forEachStatementList((statements, context) => {
		statements.forEach((statement, index) => {
			const kind = paddedKindOf(statement);
			if (!kind) return;
			const previous = statements[index - 1];
			const next = statements[index + 1];
			if (previous)
				requireBlankLine(context, previous, statement, 'above', kind);
			if (next)
				requireBlankLine(context, statement, next, 'below', kind);
		});
	}),
};

/**
 * The linted file's path from the directory oxlint runs in, so a
 * `__tests__` above the repository never counts.
 */
const repositoryPath = (context: Context): string => {
	const path = relative(context.cwd, context.filename);
	return path.startsWith('..') || isAbsolute(path)
		? context.filename
		: path;
};

const testsInTestsDir: Rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'A test file lives in a __tests__ directory beside the code it tests, never beside the code itself.',
		},
		messages: {
			beside:
				'A test file lives in a __tests__ directory beside the code it tests: move {{name}} to {{path}}.',
		},
	},
	create: context => ({
		Program: () => {
			const path = repositoryPath(context);
			if (!TEST_FILE.test(path) || path.split(sep).includes(TESTS_DIR))
				return;
			const name = basename(path);
			context.report({
				loc: { line: 1, column: 0 },
				messageId: 'beside',
				data: { name, path: join(dirname(path), TESTS_DIR, name) },
			});
		},
	}),
};

const plugin = {
	meta: { name: 'four7' },
	rules: {
		'constants-first': constantsFirst,
		'padded-declarations': paddedDeclarations,
		'tests-in-tests-dir': testsInTestsDir,
	},
};

export default plugin;
