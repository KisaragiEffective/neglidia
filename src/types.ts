export function make2<A, B>(a: A, b: B): [A, B] {
	return [a, b];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExtractTypeAssertionFromFunctionSignature<F extends (e: any) => boolean> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	F extends ((e: any) => e is infer Predicate)
		? Predicate
		: never;
export type ReplaceNever<L, R> = [L] extends [never] ? R : L;

export function castToPartial<A>(a: A): Partial<A> {
	return a
}

export function omitKeyInPlace<R extends object, K extends keyof R>(o: R, key: K): Omit<R, K> {
	const a = castToPartial(o);
	delete a[key];

	// TypeScript cannot recognize that actual `typeof a <:< Omit<R, K>`
	// However, it is a valid concern, because Partial<R> may be `{}` in the worst case.
	// So I decide tell a "lie", but this is safe.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return a as any;
}

export type Values<A extends unknown[]> = A extends (infer E)[] ? E : never;

export type Cast<A, B> = A & B;

export type Exactly<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: { error: "B is not assignable to A" }
	: { error: "A is not assignable to B" };

export function assertTypeAssignability<A>(a: A) { return a; }