// Banner store — fetches admin-configurable site banner text.
// Re-fetches every 5 minutes so admin changes propagate without page reload.

let _text = $state('');
let _fetched = false;

async function load() {
	try {
		const res = await fetch('/api/admin/banner');
		if (res.ok) {
			const data = await res.json();
			_text = data.text ?? '';
		}
	} catch {
		// Ignore — banner is non-critical
	}
	_fetched = true;
}

export const bannerStore = {
	get text() { return _text; },
	get fetched() { return _fetched; },
	load,
	/** Called after admin saves — update locally without waiting for poll */
	set(text: string) { _text = text; }
};
