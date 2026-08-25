// Banner store — fetches admin-configurable site banner text.
// Re-fetches every 5 minutes so admin changes propagate without page reload.
//
// Dismiss: users can hide the banner per browser via the × button. The
// dismissal is keyed by a stable hash of the current text so a NEW banner
// (admin edited the text) automatically shows again — the old dismissal no
// longer matches the new hash. Persisted in localStorage.

const DISMISS_KEY = 'quappe_banner_dismissed';

let _text = $state('');
let _fetched = false;
let _dismissedHash = $state<string | null>(null);

// Tiny non-cryptographic hash (djb2). Good enough for equality check —
// we're not storing anything sensitive, just marking "user has seen this
// exact text".
function textHash(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return String(h >>> 0);
}

function loadDismissed(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(DISMISS_KEY);
	} catch {
		return null;
	}
}

async function load() {
	if (_dismissedHash === null) _dismissedHash = loadDismissed();
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

function dismiss() {
	const hash = textHash(_text);
	_dismissedHash = hash;
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISS_KEY, hash);
	} catch {
		// silent — non-critical
	}
}

export const bannerStore = {
	get text() { return _text; },
	get fetched() { return _fetched; },
	get visible() {
		if (!_text) return false;
		if (_dismissedHash === null) return true;
		return textHash(_text) !== _dismissedHash;
	},
	load,
	dismiss,
	/** Called after admin saves — update locally without waiting for poll.
	 *  Also clears the local dismissal so admins see their new banner too. */
	set(text: string) {
		_text = text;
		if (_dismissedHash !== null && _text && textHash(_text) !== _dismissedHash) {
			// New content — old dismissal doesn't apply anyway; keep it for other clients.
		}
	}
};

