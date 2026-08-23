// The topics a user follows — categories and hashtags they picked (in the
// onboarding wizard or on the feed). Drives the personalized start feed.
// Browser-only, persisted in localStorage. Empty = "not chosen yet" → the feed
// falls back to trending for everyone.

const CAT_KEY = 'quappe_interests_categories';
const TAG_KEY = 'quappe_interests_hashtags';
const CHOSEN_KEY = 'quappe_interests_chosen';

function loadList(key: string): string[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

function save(key: string, list: string[]): void {
	if (typeof window !== 'undefined') localStorage.setItem(key, JSON.stringify(list));
}

class InterestsStore {
	categories = $state<string[]>(loadList(CAT_KEY));
	hashtags = $state<string[]>(loadList(TAG_KEY));
	// Whether the user has made an explicit choice (even choosing nothing counts,
	// so we don't nag them again). Distinguishes "empty by choice" from "new".
	chosen = $state<boolean>(
		typeof window !== 'undefined' && localStorage.getItem(CHOSEN_KEY) === '1'
	);

	get hasInterests(): boolean {
		return this.categories.length > 0 || this.hashtags.length > 0;
	}

	toggleCategory(cat: string): void {
		this.categories = this.categories.includes(cat)
			? this.categories.filter((c) => c !== cat)
			: [...this.categories, cat];
		save(CAT_KEY, this.categories);
	}

	toggleHashtag(tag: string): void {
		this.hashtags = this.hashtags.includes(tag)
			? this.hashtags.filter((t) => t !== tag)
			: [...this.hashtags, tag];
		save(TAG_KEY, this.hashtags);
	}

	markChosen(): void {
		this.chosen = true;
		if (typeof window !== 'undefined') localStorage.setItem(CHOSEN_KEY, '1');
	}

	clear(): void {
		this.categories = [];
		this.hashtags = [];
		save(CAT_KEY, []);
		save(TAG_KEY, []);
	}
}

export const interestsStore = new InterestsStore();
