// Global categories store - editable by admin
// In MVP, everyone is admin

import type { Category } from '$lib/models/types';
import { DEFAULT_CATEGORIES } from '$lib/models/types';
import { m } from '$lib/paraglide/messages';

let _categories = $state<Category[]>([...DEFAULT_CATEGORIES]);

// Display label for a category. Only the fixed domain categories are translatable
// proper nouns; imported repo names (e.g. "documentation-customer") and "drafts"
// have no message and render verbatim. Paraglide has no runtime string-keyed
// lookup, so map the known names to their message functions explicitly.
const CATEGORY_LABELS: Record<string, () => string> = {
	education: m.category_education,
	policy: m.category_policy,
	health: m.category_health,
	family: m.category_family,
	fairness: m.category_fairness,
	environment: m.category_environment,
	economy: m.category_economy,
	technology: m.category_technology,
	culture: m.category_culture,
	other: m.category_other
};

export function categoryLabel(name: string): string {
	return CATEGORY_LABELS[name]?.() ?? name;
}

export const categoriesStore = {
	get list(): Category[] {
		return _categories;
	},
	add(cat: Category) {
		const normalized = cat.trim().toLowerCase();
		if (normalized && !_categories.includes(normalized)) {
			_categories = [..._categories, normalized];
		}
	},
	remove(cat: Category) {
		_categories = _categories.filter((c) => c !== cat);
	},
	set(cats: Category[]) {
		_categories = cats;
	},
	reset() {
		_categories = [...DEFAULT_CATEGORIES];
	}
};
