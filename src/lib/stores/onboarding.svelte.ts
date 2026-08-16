// Tracks whether the first-contact wizard has been seen/completed, so it shows
// exactly once automatically. Persisted in localStorage; can be re-opened from
// Settings. Browser-only UI state — no server involvement.

const KEY = 'quappe_onboarded';

function load(): boolean {
	if (typeof window === 'undefined') return true; // never show during SSR
	return localStorage.getItem(KEY) === '1';
}

class OnboardingStore {
	done = $state<boolean>(load());
	// Explicitly opened from Settings (overrides `done` for one showing).
	forced = $state<boolean>(false);

	get open(): boolean {
		return this.forced || !this.done;
	}

	complete(): void {
		this.done = true;
		this.forced = false;
		if (typeof window !== 'undefined') localStorage.setItem(KEY, '1');
	}

	reopen(): void {
		this.forced = true;
	}
}

export const onboardingStore = new OnboardingStore();
