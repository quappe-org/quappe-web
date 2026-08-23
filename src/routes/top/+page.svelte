<script lang="ts">
	import type { Thesis } from '$lib/models/types';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { activityStore } from '$lib/stores/activity.svelte';
	import ThesisCard from '$lib/components/ThesisCard.svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	// The three rankings this page combines. Default = trending (server-loaded).
	type RankView = 'trending' | 'top' | 'crystallized';
	const QUERY: Record<RankView, string> = {
		trending: 'trending=true',
		top: 'top=true',
		crystallized: 'crystallized=true'
	};

	let view = $state<RankView>('trending');

	// svelte-ignore state_referenced_locally
	let allTheses = $state<Thesis[]>(data.theses ?? []);
	// svelte-ignore state_referenced_locally
	let heat = $state<Record<string, number>>(data.heat ?? {});
	// svelte-ignore state_referenced_locally
	let argumentCounts = $state<Record<string, number>>(data.argumentCounts ?? {});
	let loading = $state(false);

	$effect(() => {
		activityStore.set(data.activity ?? [], m.my_platform_activity());
	});

	// Fetch a ranking client-side. Trending is already loaded server-side, so we
	// only hit the network when the user switches (or re-selects) a view.
	async function loadView(next: RankView) {
		view = next;
		loading = true;
		try {
			const res = await fetch(`/api/theses?${QUERY[next]}&limit=50`);
			if (res.ok) {
				const fresh = (await res.json()) as Thesis[];
				if (Array.isArray(fresh)) allTheses = fresh;
			}
			// Refresh stats too so heat/arg counts stay meaningful.
			const statsRes = await fetch('/api/stats');
			if (statsRes.ok) {
				const stats = (await statsRes.json()) as {
					heat: Record<string, number>;
					arguments: Record<string, number>;
				};
				heat = stats.heat ?? {};
				argumentCounts = stats.arguments ?? {};
			}
		} finally {
			loading = false;
		}
	}

	let visibleTheses = $derived(allTheses.slice(0, complexityStore.settings.max_theses));
</script>

<section class="page">
	<div class="section">
		<div class="rank-switch" role="group" aria-label={m.top_filter_title()}>
			<button class="rs-btn" class:active={view === 'trending'} onclick={() => loadView('trending')}>
				{m.top_view_trending()}
			</button>
			<button class="rs-btn" class:active={view === 'top'} onclick={() => loadView('top')}>
				{m.top_view_top()}
			</button>
			<button class="rs-btn" class:active={view === 'crystallized'} onclick={() => loadView('crystallized')}>
				{m.top_view_crystallized()}
			</button>
		</div>
	</div>

	<div class="section">
		<div class="section-head">
			<span class="section-meta">{m.top_list_count({ visible: visibleTheses.length, total: allTheses.length })}</span>
		</div>

		{#if loading && visibleTheses.length === 0}
			<p class="empty-state">{m.top_loading()}</p>
		{:else}
			<div class="grid grid-2" class:is-loading={loading}>
				{#each visibleTheses as thesis, i (thesis.id)}
					<div class="ranked-card">
						<span class="rank">#{i + 1}</span>
						<ThesisCard {thesis} heatRatio={heat[thesis.id] ?? 0} argumentCount={argumentCounts[thesis.id] ?? 0} />
					</div>
				{/each}
			</div>

			{#if visibleTheses.length === 0}
				<p class="empty-state">{m.top_empty()}</p>
			{/if}

			{#if allTheses.length > visibleTheses.length}
				<p class="limit-note">{m.complexity_slider_hint()}</p>
			{/if}
		{/if}
	</div>
</section>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}

	.section-meta {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		font-family: var(--font-mono);
	}

	/* Segmented 3-way switch */
	.rank-switch {
		display: inline-flex;
		gap: 2px;
		background: var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		align-self: flex-start;
		flex-wrap: wrap;
	}

	.rs-btn {
		padding: 0.45rem 1rem;
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: inherit;
		background: var(--color-surface);
		color: var(--color-text-muted);
		border: none;
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.rs-btn:hover {
		color: var(--color-text);
	}

	.rs-btn.active {
		background: var(--color-primary-bg);
		color: var(--color-primary);
		font-weight: 600;
	}

	.grid.is-loading {
		opacity: 0.5;
		transition: opacity var(--transition-fast);
	}

	.ranked-card {
		position: relative;
	}

	.rank {
		position: absolute;
		top: -0.75rem;
		left: -0.75rem;
		background: var(--color-primary);
		color: white;
		font-size: var(--text-sm);
		font-weight: 700;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		min-width: 2rem;
		height: 2rem;
		padding: 0 0.5rem;
		border-radius: 9999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		z-index: 1;
		border: 2px solid var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.empty-state {
		text-align: center;
		color: var(--color-text-muted);
		padding: 2rem 1rem;
	}

	.limit-note {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--color-text-light);
		padding: 0.25rem;
		margin: 0;
	}
</style>
