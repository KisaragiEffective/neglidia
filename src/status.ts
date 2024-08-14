export const notComputedMarker = Symbol();
export type Status = { diffAction: 'not computed', reason: typeof notComputedMarker }
	| { diffAction: 'drop' | 'keep' | 'left', reason: string };
