import babel from '@babel/core';
import { Cast, make2, Values } from './types.js';

function isNotPatternRelatedExpression<
	A extends Values<babel.types.ObjectExpression["properties"]>
>(a: A): a is DirectlyInitializedObjectExpression<A> {
	return a.type === "ObjectProperty"
		&& a.value.type !== "ArrayPattern"
		&& a.value.type !== "AssignmentPattern"
		&& a.value.type !== "ObjectPattern"
		&& a.value.type !== "RestElement";
}

type DirectlyInitializedObjectExpression<A> = (
	Cast<A, babel.types.ObjectProperty>
	& {
	value: {
		type: Exclude<(Cast<A, babel.types.ObjectProperty>)["value"]["type"], PatternKinds>
	}
});
type PatternKinds = "ArrayPattern" | "AssignmentPattern" | "ObjectPattern" | "RestElement";

/**
 * 与えられた2つの式が違うかどうかを返す。もし`true`が返れば絶対に違う式だが、`false`が返った時に同じ式であるとは限らない。
 * @param left
 * @param right
 */
function definitelyDifferentBabelExpression(left: babel.types.Expression, right: babel.types.Expression): boolean {
	if (left === right) {
		return false;
	}

	if (left.type !== right.type) {
		return true;
	}

	if (left.type === "ObjectExpression") {
		const l = left;
		const r = right as babel.types.ObjectExpression;
		if (l.properties === r.properties) {
			return false;
		}

		if (l.properties.length !== r.properties.length) {
			return true;
		}

		return l.properties
			.some((lp, i) => {
				const rp = r.properties[i];

				return isNotPatternRelatedExpression(lp)
					&& isNotPatternRelatedExpression(rp)
					&& definitelyDifferentBabelExpression(lp.value, rp.value);
			});
	} else if (left.type === "StringLiteral") {
		const l = left;
		const r = right as babel.types.StringLiteral;
		return l.value !== r.value;
	} else {
		throw new RangeError(`unsupported expression type: ${left.type}`);
	}
}

export function definitelyDifferentArrayInitializers(left: babel.types.Expression[], right: babel.types.Expression[]) {
	function* zip<T>(left: readonly T[], right: readonly T[]) {
		const len = left.length;
		for (let i = 0; i < len; i++) {
			yield make2(left[i], right[i]);
		}
	}

	if (left.length !== right.length) {
		return true;
	}

	for (const [l, r] of zip(left, right)) {
		if (definitelyDifferentBabelExpression(l, r)) {
			return true;
		}
	}

	return false;
}

function tryExtractInitializer<
	R extends babel.types.Node & { body: babel.types.Statement[] }
>(root: R, declarationIdentifier: string): babel.types.VariableDeclarator[][] {
	// TODO: var [a, b] = [c, d] や var {a, b} = { a: c, b: d } にも対応するべき時が来たらそうする
	return root.body
		.filter(a => a.type === "VariableDeclaration")
		.filter(a => a.declarations.some(decl => decl.id.type === "Identifier" && decl.id.name === declarationIdentifier))
		.map(a => a.declarations);
}

export function extractInitializerLogic(program: babel.types.Program, identifier: string) {
	const patreonWithIconDeclarationCandidates = tryExtractInitializer(program, identifier)
		.flatMap(a => a.filter(b => !!b.init));

	if (patreonWithIconDeclarationCandidates.length === 0) {
		throw new Error('no such declaration could be found');
	}

	const patreonWithIconDeclaration = patreonWithIconDeclarationCandidates[0];

	if (!('init' in patreonWithIconDeclaration) || !patreonWithIconDeclaration.init) {
		throw new Error('the declaration does not have init expression');
	}

	const valueOfPatreonWithIcon = patreonWithIconDeclaration.init;

	if (!valueOfPatreonWithIcon) {
		throw new Error('the declaration does not have init expression');
	}

	if (valueOfPatreonWithIcon.type !== "ArrayExpression") {
		throw new Error('init expression is not an array');
	}

	const e = valueOfPatreonWithIcon.elements;
	if (!e.every(v => v && v.type !== "SpreadElement")) {
		throw new Error('init expression contains empty slots and/or spread operators');
	}

	return {
		node: valueOfPatreonWithIcon,
		initializers: e as babel.types.Expression[],
	}
}

export function fetchActualValues(script: string, language: string, identifiers: { withImage: string, onlyName: string }) {
	const untypedScript = language === "ts"
		? babel.transformSync(script, {
			presets: ["@babel/preset-typescript"],
			filename: 'input.ts',
		})
		: { code: script };

	if (!untypedScript || !untypedScript.code) {
		throw new Error('babel failed transform!');
	}

	const parsed = babel.parseSync(untypedScript.code);
	if (!parsed) {
		throw new Error('babel failed to parse script!');
	}

	if (!parsed.program) {
		throw new Error('AST is nullish');
	}

	return {
		withIcon: extractInitializerLogic(parsed.program, identifiers.withImage),
		namesOnly: extractInitializerLogic(parsed.program, identifiers.onlyName),
	};
}
