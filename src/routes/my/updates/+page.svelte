<script lang="ts">
	import { updatesStore, type UpdateEvent } from '$lib/stores/updates.svelte';
	import ScrollSentinel from '$lib/components/ScrollSentinel.svelte';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	let mounted = $state(false);

	onMount(() => {
		mounted = true;
		updatesStore.refresh();
	});

	// ---- Type filter ----
	type Filter = 'all' | 'fork' | 'new_argument' | 'lifecycle';
	let filter = $state<Filter>('all');

	let filtered = $derived.by(() =>
		filter === 'all'
			? updatesStore.events
			: updatesStore.events.filter((e) => e.kind === filter)
	);

	// ---- Paging (infinite scroll) ----
	const PAGE = 25;
	let shown = $state(PAGE);
	$effect(() => {
		filter; // reset paging when the filter changes
		shown = PAGE;
	});
	let page = $derived(filtered.slice(0, shown));

	// ---- Time grouping with date separators ----
	interface TimeGroup {
		key: string;
		label: string;
		events: UpdateEvent[];
	}

	function startOfDay(d: Date): number {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	}

	let groups = $derived.by<TimeGroup[]>(() => {
		const now = new Date();
		const todayStart = startOfDay(now);
		const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
		const out: TimeGroup[] = [];
		const byKey = new Map<string, TimeGroup>();
		for (const e of page) {
			const d = new Date(e.at);
			const t = d.getTime();
			let key: string;
			let label: string;
			if (t >= todayStart) {
				key = 'today';
				label = m.my_time_today();
			} else if (t >= weekStart) {
				key = 'week';
				label = m.my_time_week();
			} else {
				key = `${d.getFullYear()}-${d.getMonth()}`;
				label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
			}
			let g = byKey.get(key);
			if (!g) {
				g = { key, label, events: [] };
				byKey.set(key, g);
				out.push(g);
			}
			g.events.push(e);
		}
		return out;
	});

	function typeLabel(kind: UpdateEvent['kind']): string {
		if (kind === 'fork') return m.updates_type_fork();
		if (kind === 'new_argument') return m.updates_type_newarg();
		return m.updates_type_lifecycle();
	}

	function fmtTime(iso: string): string {
		if (!iso) return '';
		try {
			const d = new Date(iso);
			const today = new Date();
			const sameDay =
				d.getFullYear() === today.getFullYear() &&
				d.getMonth() === today.getMonth() &&
				d.getDate() === today.getDate();
			return sameDay
				? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
				: d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
		} catch {
			return iso;
		}
	}

	function markRead(e: UpdateEvent) {
		if (!e.read) updatesStore.markRead([e.event_key]);
	}

	// ---- Fork inline decision ----
	async function keepOriginal(e: UpdateEvent) {
		markRead(e);
	}

	async function switchToFork(e: UpdateEvent) {
		markRead(e);
		if (!e.fork_argument_id) return;
		try {
			await fetch(`/api/arguments/${e.fork_argument_id}/vote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'support', weight: 1 })
			});
		} catch {
			// non-fatal
		}
	}

	// ---- Swipe to mark read (touch) ----
	let swipeState = $state<{ key: string; dx: number } | null>(null);
	let sStartX = 0;
	let sStartY = 0;
	let sActive = false;
	let sAxis: 'x' | 'y' | null = null;
	const SWIPE_THRESHOLD = 70;

	function onDown(e: PointerEvent, ev: UpdateEvent) {
		if (e.pointerType === 'mouse') return;
		sActive = true;
		sStartX = e.clientX;
		sStartY = e.clientY;
		sAxis = null;
		swipeState = { key: ev.event_key, dx: 0 };
	}
	function onMove(e: PointerEvent, ev: UpdateEvent) {
		if (!sActive || !swipeState || swipeState.key !== ev.event_key) return;
		const rawDx = e.clientX - sStartX;
		const rawDy = e.clientY - sStartY;
		if (!sAxis) {
			if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
			if (Math.abs(rawDx) > Math.abs(rawDy) * 1.5) sAxis = 'x';
			else {
				sAxis = 'y';
				sActive = false;
				swipeState = null;
				return;
			}
		}
		if (sAxis !== 'x') return;
		e.preventDefault();
		swipeState = { key: ev.event_key, dx: rawDx };
	}
	function onUp(ev: UpdateEvent) {
		if (!sActive) return;
		const dx = swipeState?.dx ?? 0;
		sActive = false;
		if (Math.abs(dx) >= SWIPE_THRESHOLD) markRead(ev);
		swipeState = null;
	}

	let hasContent = $derived(updatesStore.events.length > 0);
</script>

<section class="updates-page">
	<div class="page-head">
		<h1 class="page-title">{m.updates_page_title()}</h1>
		<p class="page-subtitle">{m.updates_page_subtitle()}</p>
	</div>

	{#if hasContent}
		<div class="updates-toolbar">
			<div class="type-filter" role="group" aria-label={m.updates_filter_label()}>
				<button class="tf-btn" class:active={filter === 'all'} onclick={() => filter = 'all'}>{m.updates_filter_all()}</button>
				<button class="tf-btn" class:active={filter === 'new_argument'} onclick={() => filter = 'new_argument'}>{m.updates_type_newarg()}</button>
				<button class="tf-btn" class:active={filter === 'fork'} onclick={() => filter = 'fork'}>{m.updates_type_fork()}</button>
				<button class="tf-btn" class:active={filter === 'lifecycle'} onclick={() => filter = 'lifecycle'}>{m.updates_type_lifecycle()}</button>
			</div>
			{#if updatesStore.unread > 0}
				<button class="mark-all-btn" onclick={() => updatesStore.markAllRead()}>{m.updates_mark_all_read()}</button>
			{/if}
		</div>
	{/if}

	{#if updatesStore.loading && updatesStore.events.length === 0}
		<p class="updates-status">{m.updates_loading()}</p>
	{:else if mounted && !hasContent}
		<div class="updates-empty card">
			<p><strong>{m.updates_empty_head()}</strong></p>
			<p>{m.updates_empty_body()}</p>
		</div>
	{:else if mounted}
		{#each groups as group (group.key)}
			<div class="time-divider">{group.label}</div>
			<ul class="updates-list">
				{#each group.events as e (e.event_key)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<li
						class="updates-item card updates-{e.kind}"
						class:is-read={e.read}
						style={swipeState?.key === e.event_key ? `transform: translateX(${swipeState.dx}px)` : ''}
						onpointerdown={(ev) => onDown(ev, e)}
						onpointermove={(ev) => onMove(ev, e)}
						onpointerup={() => onUp(e)}
						onpointercancel={() => { sActive = false; swipeState = null; }}
					>
						<div class="updates-item-row">
							<span class="updates-type updates-type-{e.kind}">{typeLabel(e.kind)}</span>
							<time class="updates-time">{fmtTime(e.at)}</time>
							{#if e.kind === 'lifecycle' && e.lifecycle_state}
								<span class="updates-lifecycle-state">{e.lifecycle_state}</span>
							{/if}
							<a class="updates-thesis" href="/thesis/{e.thesis_id}" onclick={() => markRead(e)}>{e.thesis_title}</a>
							{#if !e.read}<span class="unread-dot" aria-label={m.updates_unread()}></span>{/if}
						</div>

						{#if e.kind === 'new_argument'}
							<p class="updates-content">{e.argument_content}</p>
						{:else if e.kind === 'lifecycle'}
							<p class="updates-content-muted">{m.updates_lifecycle_now({ state: e.lifecycle_state ?? '' })}</p>
						{:else if e.kind === 'fork'}
							<div class="fork-inline">
								<div class="fork-inline-pair">
									<div class="fork-inline-side">
										<span class="fork-inline-label">{m.updates_fork_original()}</span>
										<p class="fork-inline-text">{e.original_content}</p>
										<span class="fork-inline-votes">{e.original_votes ?? 0}</span>
									</div>
									<div class="fork-inline-side">
										<span class="fork-inline-label fork-inline-label-new">{m.updates_fork_variant()}</span>
										<p class="fork-inline-text">{e.fork_content}</p>
										<span class="fork-inline-votes">{e.fork_votes ?? 0}</span>
									</div>
								</div>
								<div class="fork-inline-actions">
									<button class="fork-inline-btn" onclick={() => keepOriginal(e)}>{m.panel_fork_updates_keep_old()}</button>
									<button class="fork-inline-btn fork-inline-switch" onclick={() => switchToFork(e)}>{m.panel_fork_updates_switch_new()}</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/each}

		{#if filtered.length > shown}
			<ScrollSentinel onVisible={() => shown += PAGE} />
			<div class="load-more-wrap">
				<button class="btn btn-sm" onclick={() => shown += PAGE}>{m.my_load_more()}</button>
			</div>
		{/if}

		{#if filtered.length === 0}
			<p class="updates-status">{m.updates_filter_empty()}</p>
		{/if}
	{/if}
</section>

<style>
	.updates-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.updates-page :global(.card) {
		padding: 0.75rem 1rem;
	}

	.page-head {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-bottom: 0.1rem;
	}

	.page-title {
		font-size: var(--text-2xl);
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}

	.page-subtitle {
		color: var(--color-text-muted);
		font-size: var(--text-base);
		margin: 0;
	}

	.updates-status {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-align: center;
		padding: 1rem;
	}

	.updates-empty {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.updates-empty p:first-child {
		font-size: var(--text-base);
	}

	.updates-empty p:last-child {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	/* ---- Toolbar: type filter + mark all ---- */
	.updates-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.type-filter {
		display: inline-flex;
		gap: 2px;
		background: var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		flex-wrap: wrap;
	}

	.tf-btn {
		padding: 0.45rem 0.9rem;
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: inherit;
		background: var(--color-surface);
		color: var(--color-text-muted);
		border: none;
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.tf-btn:hover {
		color: var(--color-text);
	}

	.tf-btn.active {
		background: var(--color-primary-bg);
		color: var(--color-primary);
		font-weight: 600;
	}

	.mark-all-btn {
		font-size: var(--text-sm);
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		font-family: inherit;
		padding: 0.3rem 0.5rem;
	}

	.mark-all-btn:hover {
		text-decoration: underline;
	}

	/* ---- Date separators ---- */
	.time-divider {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-light);
		padding: 0.5rem 0 0.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	/* ---- Unified list ---- */
	.updates-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.updates-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		position: relative;
		touch-action: pan-y;
		border-left: 3px solid transparent;
		transition: opacity var(--transition-base), transform 0.18s ease-out;
	}

	.updates-item.is-read {
		opacity: 0.6;
	}

	.updates-item.updates-fork { border-left-color: #f97316; }
	.updates-item.updates-new_argument { border-left-color: var(--color-primary); }
	.updates-item.updates-lifecycle { border-left-color: #8b5cf6; }

	.updates-item-row {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.updates-type {
		display: inline-block;
		padding: 0.08rem 0.45rem;
		font-size: 0.65rem;
		font-weight: 700;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		flex-shrink: 0;
	}

	.updates-type-fork { background: #ffedd5; color: #9a3412; }
	.updates-type-new_argument { background: var(--color-primary-bg); color: var(--color-primary); }
	.updates-type-lifecycle { background: #ede9fe; color: #5b21b6; }

	.updates-time {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--color-text-light);
		flex-shrink: 0;
	}

	.updates-thesis {
		font-size: var(--text-sm);
		color: var(--color-text);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1;
	}

	.updates-thesis:hover {
		color: var(--color-primary);
	}

	.unread-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-primary);
		flex-shrink: 0;
	}

	.updates-lifecycle-state {
		display: inline-block;
		padding: 0.05rem 0.35rem;
		font-size: 0.65rem;
		font-weight: 600;
		border-radius: var(--radius-sm);
		text-transform: capitalize;
		background: #ede9fe;
		color: #5b21b6;
	}

	.updates-content,
	.updates-content-muted {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.45;
	}

	.updates-content { color: var(--color-text); }
	.updates-content-muted { color: var(--color-text-muted); }

	/* ---- Inline fork decision ---- */
	.fork-inline {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.fork-inline-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	@media (max-width: 480px) {
		.fork-inline-pair {
			grid-template-columns: 1fr;
		}
	}

	.fork-inline-side {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
	}

	.fork-inline-label {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.fork-inline-label-new {
		color: #059669;
	}

	.fork-inline-text {
		margin: 0;
		font-size: var(--text-xs);
		line-height: 1.4;
		color: var(--color-text);
	}

	.fork-inline-votes {
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--color-text-light);
		font-family: var(--font-mono);
	}

	.fork-inline-actions {
		display: flex;
		gap: 0.5rem;
	}

	.fork-inline-btn {
		flex: 1;
		font-size: var(--text-xs);
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
		font-family: inherit;
		transition: background var(--transition-base), border-color var(--transition-base);
	}

	.fork-inline-btn:hover {
		background: var(--color-border);
	}

	.fork-inline-switch {
		background: #ecfdf5;
		border-color: #6ee7b7;
		color: #059669;
		font-weight: 600;
	}

	.fork-inline-switch:hover {
		background: #059669;
		border-color: #059669;
		color: white;
	}

	.load-more-wrap {
		display: flex;
		justify-content: center;
		padding: 0.75rem 0;
	}
</style>
