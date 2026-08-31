// Instance auth state. On gated (business) instances the user must log in with
// an access secret before using the app; anonymous instances (quappe.org) need
// nothing. Fetched once from /api/auth/status.

import { m } from '$lib/paraglide/messages';

export type AuthMode = 'anonymous' | 'gated';
export type Role = 'admin' | 'member' | null;

class AuthStore {
	mode = $state<AuthMode>('anonymous');
	role = $state<Role>(null);
	needsLogin = $state(false);
	loaded = $state(false);
	error = $state<string | null>(null);

	async refresh(): Promise<void> {
		if (typeof window === 'undefined') return;
		try {
			const res = await fetch('/api/auth/status');
			if (!res.ok) return;
			const data = await res.json();
			this.mode = data.mode ?? 'anonymous';
			this.role = data.role ?? null;
			this.needsLogin = !!data.needs_login;
		} catch {
			// leave defaults — anonymous
		} finally {
			this.loaded = true;
		}
	}

	async login(secret: string): Promise<boolean> {
		this.error = null;
		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ secret })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				if (res.status === 429 || body?.code === 'rate_limited') {
					this.error = m.error_too_many_requests();
				} else if (res.status === 401 || body?.code === 'invalid_secret') {
					this.error = 'Invalid secret';
				} else {
					this.error = m.error_server_generic({ status: res.status });
				}
				return false;
			}
			const data = await res.json();
			this.role = data.role ?? 'member';
			this.needsLogin = false;
			return true;
		} catch {
			this.error = 'Login failed';
			return false;
		}
	}

	async logout(): Promise<void> {
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
		} catch {
			// ignore
		}
		this.role = null;
		if (this.mode === 'gated') this.needsLogin = true;
	}
}

export const authStore = new AuthStore();
