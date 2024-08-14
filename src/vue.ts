import {
	type ElementNode,
	ElementTypes, type ExpressionNode,
	NodeTypes,
	type RootNode,
	type TemplateChildNode,
	type TemplateNode
} from '@vue/compiler-dom';
import {
	assertTypeAssignability,
	type ExtractTypeAssertionFromFunctionSignature,
	make2,
	omitKeyInPlace,
	type ReplaceNever
} from './types.js';
import babel from '@babel/core';
import { fetchActualValues } from './babel.js';

export function recursiveSearch<F extends (e: TemplateChildNode) => boolean, T>(
	rootElement: ElementNode | TemplateChildNode,
	condition: F,
	// TODO: これだと元からexpr is neverだったのか区別できないのでghost symbol in ghost moduleパターンを採用してセキュアにするべき
	map: (r: ReplaceNever<ExtractTypeAssertionFromFunctionSignature<F>, ElementNode | TemplateChildNode>) => T,
	acc: T[] = []
): T[] {
	if (rootElement.type !== NodeTypes.ELEMENT) {
		return acc;
	}

	if (rootElement.children.length === 0) {
		return acc;
	}

	return [
		...acc,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		...rootElement.children.filter(condition).map(map as any) as T[],
		...rootElement.children.flatMap(e => recursiveSearch(e, condition, map, acc))
	];
}

// #region sanity check
{
	function chop(e: ElementNode | TemplateChildNode): e is ElementNode {
		return e.type === NodeTypes.ELEMENT;
	}

	assertTypeAssignability<(e: ElementNode) => ElementNode[]>(
		(element: ElementNode) => recursiveSearch(element, chop, a => a)
	);
}
// #endregion

function pickOnlyDivTag(e: ElementNode | TemplateChildNode): e is ElementNode {
	return e.type === NodeTypes.ELEMENT && e.tag === "div"
}

export function findComponentTemplateOrFail(root: RootNode) {
	const templateCandidates = root.children.filter(node => node.type === NodeTypes.ELEMENT);
	if (templateCandidates.length === 0) {
		throw new Error("supplied file does not contain template!?");
	}

	return templateCandidates[0];
}

// TODO: template > MkStickyContainer > div:first > MkSpacer > divを取得する一連の操作を切り出す
export function tryExtractSpecialThanksSection(node: ElementNode): false | { value: ElementNode } {
	if (node.children.length === 1 && node.children[0].type === NodeTypes.ELEMENT && node.children[0].tag === "MkStickyContainer") {
		const sc = node.children[0];
		const divCandidates = sc.children
			.filter((e) => e.type === NodeTypes.ELEMENT && e.tag === "div")[0];

		if (divCandidates && divCandidates.type === NodeTypes.ELEMENT && divCandidates.tag === "div") {
			const div = divCandidates;

			if (div.children.length === 1 && div.children[0].type === NodeTypes.ELEMENT && div.children[0].tag === "MkSpacer") {
				const spacer = div.children[0];
				if (spacer.children.length === 1 && spacer.children[0].type === NodeTypes.ELEMENT && spacer.children[0].tag === "div") {
					const body = spacer.children[0];

					return { value: body };
				} else {
					return false;
				}
			} else {
				return false;
			}
		} else {
			return false;
		}
	} else {
		return false;
	}
}

function tryExtractTemplateElementWithLabelSlot(templateParent: ElementNode): false | { values: TemplateNode[] } {
	const templates = templateParent.children.filter(x => x.type === NodeTypes.ELEMENT && x.tagType === ElementTypes.TEMPLATE);
	const candidates = templates.filter(template => {
		// TODO: 多分これはよくないのでprops.arg[type = 4].{content, constType}をみるべき
		return template.props.filter(prop => prop.type === NodeTypes.DIRECTIVE).some(x => x.rawName === "#label")
	});

	return candidates.length > 0 ? { values: candidates } : false;
}

function extractIterativeRenderingIdentifiersForPatreon(formSection: ElementNode): {
	expr: ExpressionNode[],
	tiedElement: Omit<ElementNode, "loc">
}[] {
	const divisions = recursiveSearch(formSection, pickOnlyDivTag, div => {
		return omitKeyInPlace(div, "loc")
	});

	return divisions
		.flatMap(a => ({
			expr: a.props.filter(prop => prop.type === NodeTypes.DIRECTIVE).map(prop => prop.forParseResult?.source).filter(a => !!a),
			tiedElement: a
		}))
		.filter(a => a.expr && a.expr.length > 0);
}

function tryExtractPatreonIterableIdentifiers(node: ElementNode): false | { withImage: string, onlyName: string } {
	if (!(node.children.length === 1 && node.children[0].type === NodeTypes.ELEMENT && node.children[0].tag === "MkStickyContainer")) {
		return false;
	}

	const sc = node.children[0];
	const divCandidates = sc.children
		.filter((e) => e.type === NodeTypes.ELEMENT && e.tag === "div")[0];

	if (!(divCandidates && divCandidates.type === NodeTypes.ELEMENT && divCandidates.tag === "div")) {
		return false;
	}

	const div = divCandidates;

	if (!(div.children.length === 1 && div.children[0].type === NodeTypes.ELEMENT && div.children[0].tag === "MkSpacer")) {
		return false;
	}

	const spacer = div.children[0];
	if (!(spacer.children.length === 1 && spacer.children[0].type === NodeTypes.ELEMENT && spacer.children[0].tag === "div")) {
		return false;
	}

	const body = spacer.children[0];
	const formSections = body.children
		.filter(e => e.type === NodeTypes.ELEMENT)
		.filter(e => e.tag === "FormSection");

	if (formSections.length === 0) {
		throw new Error("FormSection could not be found");
	}

	const candidates = formSections
		.map((section, i) => make2(tryExtractTemplateElementWithLabelSlot(section), i))
		.filter(e => e[0])
		// さっきチェックしたのでこのキャストはセーフ。消すとnarrowingされていないので落ちる
		.map(([a, b]) => make2((a as Exclude<typeof a, false>).values, b))
		.filter(([detectedTemplates, ]) =>
			detectedTemplates.some(template =>
				template.children.some(tc =>
					tc.type === NodeTypes.INTERPOLATION
					&& tc.content.type == NodeTypes.SIMPLE_EXPRESSION
					&& tc.content.content == "i18n.ts._aboutMisskey.patrons"
				)))
		.map(([, i]) => i);

	if (candidates.length !== 1) {
		throw new Error("suitable template element could not be found");
	}

	const formSection = formSections[candidates[0]];

	const identifiers = extractIterativeRenderingIdentifiersForPatreon(formSection);

	const groups = Map.groupBy(identifiers, e => {
		return e.tiedElement.children.some(e => e.type === NodeTypes.ELEMENT && e.tag === "img");
	});

	const withImage = groups.get(true)![0].expr[0];
	if (withImage.type !== NodeTypes.SIMPLE_EXPRESSION) {
		console.error("withImage value:", withImage);
		throw new Error("withImage: not a simple expression");
	}

	const onlyName = groups.get(false)![0].expr[0];
	if (onlyName.type !== NodeTypes.SIMPLE_EXPRESSION) {
		console.error("onlyName value:" , onlyName);
		throw new Error("onlyName: not a simple expression");
	}

	return { withImage: withImage.content, onlyName: onlyName.content };
}

export function definitelyDifferentContent(left: ElementNode, right: ElementNode) {
	return left.loc.source !== right.loc.source;
}

export function tryExtractPatreonSectionData(root: RootNode): false | {
	withIcon: { node: babel.types.ArrayExpression, initializers: babel.types.Expression[] },
	namesOnly: { node: babel.types.ArrayExpression, initializers: babel.types.Expression[] },
} {
	const identifiers = tryExtractPatreonIterableIdentifiers(findComponentTemplateOrFail(root));
	if (!identifiers) {
		return false;
	}
	// console.log(identifiers);

	const setupScriptCandidate = root.children.filter(n => n.type === NodeTypes.ELEMENT && n.tag === "script");
	if (!(setupScriptCandidate.length === 1 && setupScriptCandidate[0].type === NodeTypes.ELEMENT)) {
		return false;
	}

	const scriptElement = setupScriptCandidate[0];
	if (!(scriptElement.children.length === 1 && scriptElement.children[0].type === NodeTypes.TEXT)) {
		return false;
	}

	const script = scriptElement.children[0].content;
	const lang = scriptElement.props
		.filter(p => p.type === NodeTypes.ATTRIBUTE)
		.filter(p => p.name === "lang")[0]
		?.value?.content ?? 'js';

	// console.debug("language: ", lang);

	return fetchActualValues(script, lang, identifiers);
}
