// Session-scoped store for the personalized feed's update events (forks / new
// arguments / lifecycle changes), rendered on the landing page (/).
// Fetched from /api/reports/updates. Identity comes from the server's signed
// cookie — no user_id in the URL. Refreshed on demand and via a 60s poll
// started from the root layout. Read-state is persisted server-side.

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

interface UpdatesResponse {
	user_id: string;
	generated_at: string;
	events: UpdateEvent[];
	counts: {
		forks: number;
		new_arguments: number;
		lifecycle: number;
		total: number;
		unread: number;
	};
}

class UpdatesStore {
	events = $state<UpdateEvent[]>([]);
	loading = $state(false);
	generated_at = $state<string | null>(null);
	unread = $state(0);

	async refresh(): Promise<void> {
		if (typeof window === 'undefined') return;
		if (this.loading) return;
		this.loading = true;
		try {
			const res = await fetch('/api/reports/updates');
			if (!res.ok) return;
			const body = (await res.json()) as UpdatesResponse;
			this.events = body.events;
			this.generated_at = body.generated_at;
			this.unread = body.counts?.unread ?? body.events.filter((e) => !e.read).length;
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

	async markAllRead(): Promise<void> {
		const keys = this.events.filter((e) => !e.read).map((e) => e.event_key);
		await this.markRead(keys);
	}
}

export const updatesStore = new UpdatesStore();
