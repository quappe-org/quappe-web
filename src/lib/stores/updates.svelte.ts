// Session-scoped store for the personalized feed's update events (forks / new
// arguments / lifecycle changes), rendered on the landing page (/).
// Fetched from /api/reports/updates. Identity comes from the server's signed
// cookie — no user_id in the URL. Refreshed on demand and via a 60s poll
// started from the root layout. Read-state is persisted server-side.
//
// Shape note: the service returns BOTH raw events (for granular read-
// tracking) and per-thesis groups (the rollup the feed renders). We keep the
// events around because markRead() still operates on event_keys.

export type UpdateKind = 'fork' | 'new_argument' | 'lifecycle';

export interface UpdateEvent {
	kind: UpdateKind;
	event_key: string;
	read: boolean;
	at: string;
	thesis_id: string;
	thesis_title: string;
	original_argument_id?: string;
	original_content?: string;
	original_votes?: number;
	fork_argument_id?: string;
	fork_content?: string;
	fork_votes?: number;
	argument_id?: string;
	argument_content?: string;
	lifecycle_state?: string;
}

export interface UpdateGroup {
	thesis_id: string;
	thesis_title: string;
	last_at: string;
	read: boolean;
	new_arguments: number;
	forks: number;
	lifecycle_state?: string;
	lifecycle_since?: string;
	event_keys: string[];
}

interface UpdatesResponse {
	user_id: string;
	generated_at: string;
	events: UpdateEvent[];
	groups?: UpdateGroup[];
	counts: {
		forks: number;
		new_arguments: number;
		lifecycle: number;
		total: number;
		groups?: number;
		unread: number;
		unread_groups?: number;
	};
}

class UpdatesStore {
	events = $state<UpdateEvent[]>([]);
	groups = $state<UpdateGroup[]>([]);
	loading = $state(false);
	generated_at = $state<string | null>(null);
	unread = $state(0);
	unreadGroups = $state(0);

	async refresh(): Promise<void> {
		if (typeof window === 'undefined') return;
		if (this.loading) return;
		this.loading = true;
		try {
			const res = await fetch('/api/reports/updates');
			if (!res.ok) return;
			const body = (await res.json()) as UpdatesResponse;
			this.events = body.events;
			this.groups = body.groups ?? [];
			this.generated_at = body.generated_at;
			this.unread = body.counts?.unread ?? body.events.filter((e) => !e.read).length;
			this.unreadGroups =
				body.counts?.unread_groups ?? this.groups.filter((g) => !g.read).length;
		} finally {
			this.loading = false;
		}
	}

	// Mark specific events read (optimistic local update + server persist).
	async markRead(keys: string[]): Promise<void> {
		if (keys.length === 0) return;
		const keySet = new Set(keys);
		let changed = 0;
		for (const e of this.events) {
			if (keySet.has(e.event_key) && !e.read) {
				e.read = true;
				changed++;
			}
		}
		this.unread = Math.max(0, this.unread - changed);
		// Re-derive group read-state from underlying events so the badge is
		// consistent while we wait for the next server refresh.
		const eventReadByKey = new Map(this.events.map((e) => [e.event_key, e.read]));
		let unreadGroups = 0;
		for (const g of this.groups) {
			const allRead = g.event_keys.every((k) => eventReadByKey.get(k) !== false);
			g.read = allRead;
			if (!allRead) unreadGroups++;
		}
		this.unreadGroups = unreadGroups;
		try {
			await fetch('/api/reports/updates', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ event_keys: keys })
			});
		} catch {
			// non-fatal — local state already reflects the change
		}
	}

	async markGroupRead(group: UpdateGroup): Promise<void> {
		await this.markRead(group.event_keys);
	}

	async markAllRead(): Promise<void> {
		const keys = this.events.filter((e) => !e.read).map((e) => e.event_key);
		await this.markRead(keys);
	}
}

export const updatesStore = new UpdatesStore();

