import { readFile, writeFile } from 'node:fs/promises';
import {
	definitelyDifferentContent,
	findComponentTemplateOrFail,
	tryExtractPatreonSectionData,
	tryExtractSpecialThanksSection
} from './vue.js';
import { parse as parseVueDOM } from '@vue/compiler-dom';
import { definitelyDifferentArrayInitializers } from './babel.js';
import { assertTypeAssignability, Exactly } from './types.js';

export async function run(args: Readonly<{ old: string, new: string, out?: string }>) {
	const sources = await Promise.all([
		readFile(args.old, "utf8"),
		readFile(args.new, "utf8"),
	]);

	const [oldRoot, newRoot] = sources.map(source => parseVueDOM(source));
	const templateOld = findComponentTemplateOrFail(oldRoot);
	const templateNew = findComponentTemplateOrFail(newRoot);

	const notComputedMarker = Symbol();
	type Status = { diffAction: 'not computed', reason: typeof notComputedMarker }
		| { diffAction: 'drop' | 'keep' | 'left', reason: string };
	const processingResult: { specialThanks: Status, patreon: Status } = {
		specialThanks: { diffAction: 'not computed', reason: notComputedMarker },
		patreon: { diffAction: 'not computed', reason: notComputedMarker },
	}

	// #region processing special thanks section
	{
		const [old, newer] = [
			tryExtractSpecialThanksSection(templateOld),
			tryExtractSpecialThanksSection(templateNew)
		]
		if (old && newer) {
			// console.log(old.value.tag);
			if (definitelyDifferentContent(old.value, newer.value)) {
				processingResult.specialThanks = { diffAction: 'drop', reason: 'special thanks update' };
			} else {
				processingResult.specialThanks = { diffAction: 'keep', reason: 'inner contents are same' };
			}
		} else if (!old && !newer) {
			processingResult.specialThanks = { diffAction: 'left', reason: 'both container do not contain special thanks section' };
		} else {
			processingResult.specialThanks = {
				diffAction: 'left',
				reason: 'could not compute difference: left container status and right container status are different. Is the branch diverged?'
			};
		}
	}
	// #endregion

	// #region processing patreon
	{
		const [old, newer] = [
			tryExtractPatreonSectionData(oldRoot),
			tryExtractPatreonSectionData(newRoot)
		]

		if (old && newer) {
			if (
				definitelyDifferentArrayInitializers(old.withIcon.initializers, newer.withIcon.initializers)
				|| definitelyDifferentArrayInitializers(old.namesOnly.initializers, newer.namesOnly.initializers)
			) {
				processingResult.patreon = { diffAction: 'drop', reason: 'patreon update' };
			} else {
				processingResult.patreon = { diffAction: 'keep', reason: 'inner contents are same' };
			}
		} else if (!old && !newer) {
			processingResult.patreon = { diffAction: 'left', reason: 'both container do not contain special thanks section' };
		} else {
			processingResult.patreon = {
				diffAction: 'left',
				reason: 'could not compute difference: left container status and right container status are different. Is the branch diverged?'
			};
		}
	}
	// #endregion

	// #region sanity check
	{
		const allBranchesAreCovered = true;
		assertTypeAssignability<Exactly<typeof processingResult.specialThanks.reason, string>>(allBranchesAreCovered);
		assertTypeAssignability<Exactly<typeof processingResult.patreon.reason, string>>(allBranchesAreCovered);
	}
	// #endregion

	if (!('out' in args)) {
		console.log(processingResult);
	} else {
		const content = JSON.stringify(processingResult);
		await writeFile(args.out, content, {
			encoding: "utf8"
		});
	}
}
