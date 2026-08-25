// Reactive tick for the user-id cache. Bumps every time bootstrapUserId()
// replaces a stale cached id with the authoritative one from /api/me.
//
// Kept in a `.svelte.ts` file (which enables $state) so that runes-based
// consumers can subscribe to changes, while `user.ts` stays a plain module
// that TypeScript imports across `.ts` and `.svelte` callers alike.

let version = $state(0);

export function userIdTick(): number {
	return version;
}

export function bumpUserIdTick(): void {
	version++;
}
