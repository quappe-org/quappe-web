<script lang="ts">
	import type { Thesis, Category } from '$lib/models/types';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
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

	// ---- Drill-down filter (within the current ranking) ----
	let selectedFilter = $state<Category | null>(null);
	let selectedHashtag = $state<string | null>(null);

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

	// Category tiles: counts reflect the current ranking (and active hashtag),
	// mirroring the home page's drill-down. Sorted, empty categories hidden.
	let categoryCounts = $derived.by(() => {
		const counts = new Map<Category, number>();
		for (const cat of categoriesStore.list) counts.set(cat, 0);
		for (const t of allTheses) {
			if (selectedHashtag && !(t.hashtags ?? []).includes(selectedHashtag)) continue;
			for (const cat of t.categories) counts.set(cat, (counts.get(cat) ?? 0) + 1);
		}
		return counts;
	});

	let categoryTiles = $derived.by(() =>
		categoriesStore.list
			.map((cat) => ({ name: cat, count: categoryCounts.get(cat) ?? 0 }))
			.filter((t) => t.count > 0)
			.sort((a, b) => b.count - a.count)
	);

	let maxCategoryCount = $derived.by(() => {
		let mx = 0;
		for (const t of categoryTiles) if (t.count > mx) mx = t.count;
		return mx || 1;
	});

	function tileSize(count: number): 'lg' | 'md' | 'sm' {
		const ratio = count / maxCategoryCount;
		if (ratio >= 0.66) return 'lg';
		if (ratio >= 0.33) return 'md';
		return 'sm';
	}

	let hashtagCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const t of allTheses) {
			if (selectedFilter && !t.categories.includes(selectedFilter)) continue;
			for (const h of t.hashtags ?? []) counts.set(h, (counts.get(h) ?? 0) + 1);
		}
		return counts;
	});

	let hashtagTiles = $derived.by(() =>
		[...hashtagCounts.entries()]
			.map(([name, count]) => ({ name, count }))
			.filter((t) => t.count > 0)
			.sort((a, b) => b.count - a.count)
			.slice(0, 30)
	);

	// The ranking, narrowed by the active category/hashtag then capped by the
	// complexity slider. Ranking order (server) is preserved — we only filter.
	let rankedTheses = $derived.by(() => {
		let filtered = allTheses;
		if (selectedFilter) filtered = filtered.filter((t) => t.categories.includes(selectedFilter!));
		if (selectedHashtag) filtered = filtered.filter((t) => (t.hashtags ?? []).includes(selectedHashtag!));
		return filtered;
	});

	let visibleTheses = $derived(rankedTheses.slice(0, complexityStore.settings.max_theses));
</script>

<section class="page">
	<div class="section">
		<div class="segmented segmented--fill" role="group" aria-label={m.top_filter_title()}>
			<button class="segmented-btn" class:active={view === 'trending'} onclick={() => loadView('trending')}>
				{m.top_view_trending()}
			</button>
			<button class="segmented-btn" class:active={view === 'top'} onclick={() => loadView('top')}>
				{m.top_view_top()}
			</button>
			<button class="segmented-btn" class:active={view === 'crystallized'} onclick={() => loadView('crystallized')}>
				{m.top_view_crystallized()}
			</button>
		</div>
	</div>

	<div class="section">
		<div class="section-head">
			<h2 class="section-title">{m.home_filter_title()}</h2>
			{#if selectedFilter || selectedHashtag}
				<button class="clear-filter" onclick={() => { selectedFilter = null; selectedHashtag = null; }}>
					&times; {m.home_filter_clear()}
				</button>
			{/if}
		</div>
		<div class="category-tiles">
			{#each categoryTiles as tile}
				<button
					class="cat-tile"
					data-size={tileSize(tile.count)}
					class:active={selectedFilter === tile.name}
					onclick={() => (selectedFilter = selectedFilter === tile.name ? null : tile.name)}
				>
					<span class="cat-tile-name">{tile.name}</span>
					<span class="cat-tile-count">{tile.count}</span>
				</button>
			{/each}
		</div>
		{#if hashtagTiles.length > 0}
			<div class="hashtag-tiles">
				{#each hashtagTiles as tag}
					<button
						class="hashtag-chip"
						class:active={selectedHashtag === tag.name}
						onclick={() => (selectedHashtag = selectedHashtag === tag.name ? null : tag.name)}
					>
						<span class="hashtag-name">#{tag.name}</span>
						<span class="hashtag-count">{tag.count}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="section">
		<div class="section-head">
			{#if selectedFilter || selectedHashtag}
				<span class="section-filter-active">
					{#if selectedFilter}{selectedFilter}{/if}{#if selectedFilter && selectedHashtag} · {/if}{#if selectedHashtag}#{selectedHashtag}{/if}
				</span>
			{/if}
			<span class="section-meta">{m.top_list_count({ visible: visibleTheses.length, total: rankedTheses.length })}</span>
		</div>

		{#if loading && visibleTheses.length === 0}
			<p class="empty-state">{m.top_loading()}</p>
		{:else}
			<div class="grid ranked-list" class:is-loading={loading}>
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

			{#if rankedTheses.length > visibleTheses.length}
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

	.section-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.section-filter-active {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-primary);
		text-transform: capitalize;
	}

	.section-meta {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		font-family: var(--font-mono);
	}

	.clear-filter {
		background: none;
		border: none;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
	}

	.clear-filter:hover {
		color: var(--color-reject);
		background: var(--color-reject-bg);
	}

	/* Category / hashtag drill-down tiles — same shape as the home feed, so the
	   ranking can be narrowed without leaving the page. */
	.category-tiles {
		display: flex;
		gap: 0.375rem;
		overflow-x: auto;
		padding: 0.25rem 0.125rem 0.5rem;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
		-webkit-overflow-scrolling: touch;
	}
	.category-tiles::-webkit-scrollbar { height: 4px; }
	.category-tiles::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }

	.cat-tile {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		padding: 0.25rem 0.75rem;
		cursor: pointer;
		transition: all var(--transition-fast);
		font-family: inherit;
		color: var(--color-text-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.cat-tile:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.cat-tile.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.cat-tile.active .cat-tile-count {
		color: rgba(255, 255, 255, 0.85);
	}

	.cat-tile[data-size='sm'] { font-size: var(--text-xs); }
	.cat-tile[data-size='md'] { font-size: var(--text-sm); }
	.cat-tile[data-size='lg'] { font-size: var(--text-sm); font-weight: 600; }

	.cat-tile-name {
		text-transform: capitalize;
		font-weight: inherit;
	}

	.cat-tile-count {
		font-size: 0.75em;
		font-family: var(--font-mono);
		color: var(--color-text-light);
	}

	.hashtag-tiles {
		display: flex;
		gap: 0.375rem;
		overflow-x: auto;
		padding: 0.125rem 0.125rem 0.5rem;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
		-webkit-overflow-scrolling: touch;
	}
	.hashtag-tiles::-webkit-scrollbar { height: 4px; }
	.hashtag-tiles::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 2px; }

	.hashtag-chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		background: var(--color-hashtag-bg);
		border: 1px solid var(--color-hashtag-border);
		color: var(--color-hashtag);
		border-radius: 9999px;
		padding: 0.15rem 0.6rem;
		font-family: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
		transition: all var(--transition-fast);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.hashtag-chip.active {
		background: var(--color-hashtag);
		border-color: var(--color-hashtag);
		color: white;
	}

	.hashtag-chip.active .hashtag-count {
		color: rgba(255, 255, 255, 0.85);
	}

	.hashtag-count {
		font-size: 0.85em;
		font-family: var(--font-mono);
		color: color-mix(in srgb, var(--color-hashtag) 60%, transparent);
	}

	/* Ranking reads best as a single centred column, not a 2-up grid — the rank
	   numbers make order the point, so keep it linear and comfortably narrow.
	   Tile spacing uses --space-lg to match the feed and /my (tiles look the same
	   everywhere). The rank badge overhangs the top-left of each card by 0.75rem,
	   so pad the list so the first badge isn't clipped by the section above. */
	.ranked-list {
		width: 100%;
		max-width: 44rem;
		margin: 0 auto;
		padding-top: 0.75rem;
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
