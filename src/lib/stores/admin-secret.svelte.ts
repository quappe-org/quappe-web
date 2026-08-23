// Holds the admin operator secret for the current browser session.
// Entered once on the /admin page, kept in sessionStorage (cleared when the
// tab closes), and attached as the x-admin-secret header to admin API calls.
//
// This is the Phase-1 model for anonymous instances (quappe.org). On OIDC/
// business instances, admin will instead come from the SSO role claim and this
// gate becomes unnecessary.

const KEY = 'quappe_admin_secret';

function load(): string {
	if (typeof sessionStorage === 'undefined') return '';
	return sessionStorage.getItem(KEY) ?? '';
}

class AdminSecretStore {
	secret = $state<string>(load());

	set(value: string) {
		this.secret = value.trim();
		if (typeof sessionStorage !== 'undefined') {
			if (this.secret) sessionStorage.setItem(KEY, this.secret);
			else sessionStorage.removeItem(KEY);
		}
	}

	clear() {
		this.set('');
	}

	// Headers to merge into an admin fetch.
	headers(): Record<string, string> {
		return this.secret ? { 'x-admin-secret': this.secret } : {};
	}
}

export const adminSecret = new AdminSecretStore();
