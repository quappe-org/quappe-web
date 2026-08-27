<script lang="ts">
	import type { Thesis, Category } from '$lib/models/types';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
	import { activityStore } from '$lib/stores/activity.svelte';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { uiIntents } from '$lib/stores/ui.svelte';
	import { getUserId } from '$lib/stores/user';
	import { userIdTick } from '$lib/stores/user-tick.svelte';
	import { interestsStore } from '$lib/stores/interests.svelte';
	import { updatesStore, type UpdateGroup } from '$lib/stores/updates.svelte';
	import ThesisCard from '$lib/components/ThesisCard.svelte';
	import SearchBox from '$lib/components/SearchBox.svelte';
	import CreateThesisForm from '$lib/components/CreateThesisForm.svelte';
	import Popup from '$lib/components/Popup.svelte';
	import FeedList from '$lib/components/FeedList.svelte';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	onMount(() => {
		updatesStore.refresh();
	});

	// svelte-ignore state_referenced_locally
	let allTheses = $state<Thesis[]>(data.theses ?? []);
	// svelte-ignore state_referenced_locally
	let heat = $state<Record<string, number>>(data.heat ?? {});
	// svelte-ignore state_referenced_locally
	let argumentCounts = $state<Record<string, number>>(data.argumentCounts ?? {});
	$effect(() => {
		allTheses = data.theses ?? [];
		heat = data.heat ?? {};
		argumentCounts = data.argumentCounts ?? {};
		activityStore.set([], '');
	});

	// Frozen set of theses the user had ALREADY voted on at page load. We hide
	// only these; anything voted DURING the session stays put but fades out.
	// The set is only refreshed on an explicit "load more" (refreshFeed),
	// never live — so the list never rearranges under the user's hands.
	let alreadyVoted = $state<Set<string>>(new Set());
	let snapshotTaken = false;
	$effect(() => {
		if (typeof window === 'undefined' || snapshotTaken) return;
		if (allTheses.length === 0) return;
		snapshotTaken = true;
		const userId = getUserId();
		const set = new Set<string>();
		for (const t of allTheses) {
			if (t.votes.some((v) => v.user_id === userId)) set.add(t.id);
		}
		alreadyVoted = set;
	});

	// Theses the user has voted on IN THIS SESSION. They're shown greyed-out
	// for a moment (feedback: "yes, I registered your vote") then removed
	// from the feed after FADE_MS. The fade timeout lives here, not in a
	// child component, because the parent decides when the card is gone.
	const FADE_MS = 1600;
	let justVotedFadingOut = $state<Set<string>>(new Set());
	let justVotedRemoved = $state<Set<string>>(new Set());

	function noteJustVoted(thesisId: string): void {
		if (justVotedFadingOut.has(thesisId) || justVotedRemoved.has(thesisId)) return;
		const next = new Set(justVotedFadingOut);
		next.add(thesisId);
		justVotedFadingOut = next;
		setTimeout(() => {
			const done = new Set(justVotedRemoved);
			done.add(thesisId);
			justVotedRemoved = done;
		}, FADE_MS);
	}

	// Listen for external "new thesis" intent (from the top-bar button in the
	// layout). Initialise `_lastSeenIntent` to the CURRENT counter value so a
	// stale click from a previous mount of this page (the counter is module-
	// scoped and outlives navigation) doesn't re-open the form when the user
	// returns to this tab — only new clicks after mount should trigger it.
	let _lastSeenIntent = $state(uiIntents.openNewThesis);
	$effect(() => {
		const count = uiIntents.openNewThesis;
		if (count > _lastSeenIntent) {
			_lastSeenIntent = count;
			showForm = true;
		}
	});

	// ---- Search ----
	let searchQuery = $state('');
	let searchResults = $state<Thesis[]>([]);
	let searchMode = $state<'semantic' | 'fulltext' | 'combined' | 'empty' | null>(null);
	let searching = $state(false);

	let isSearching = $derived(searchQuery.trim().length >= 2);

	// ---- Filter ----
	let selectedFilter = $state<Category | null>(null);
	let selectedHashtag = $state<string | null>(null);

	let categoryCounts = $derived.by(() => {
		const counts = new Map<Category, number>();
		for (const cat of categoriesStore.list) counts.set(cat, 0);
		for (const t of allTheses) {
			if (selectedHashtag && !(t.hashtags ?? []).includes(selectedHashtag)) continue;
			for (const cat of t.categories) {
				counts.set(cat, (counts.get(cat) ?? 0) + 1);
			}
		}
		return counts;
	});

	let categoryTiles = $derived.by(() => {
		return categoriesStore.list
			.map((cat) => ({ name: cat, count: categoryCounts.get(cat) ?? 0 }))
			.filter((t) => t.count > 0)
			.sort((a, b) => b.count - a.count);
	});

	let maxCategoryCount = $derived.by(() => {
		let m = 0;
		for (const t of categoryTiles) if (t.count > m) m = t.count;
		return m || 1;
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
			for (const h of t.hashtags ?? []) {
				counts.set(h, (counts.get(h) ?? 0) + 1);
			}
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

	function matchesInterests(t: Thesis): boolean {
		if (!interestsStore.hasInterests) return false;
		for (const c of t.categories) if (interestsStore.categories.includes(c)) return true;
		for (const h of t.hashtags ?? []) if (interestsStore.hashtags.includes(h)) return true;
		return false;
	}

	// ---- Merged personalized feed ----
	type FeedItem =
		| { kind: 'update_group'; at: string; sortKey: number; group: UpdateGroup }
		| { kind: 'new_thesis'; at: string; sortKey: number; thesis: Thesis };

	function tsOf(iso: string | undefined): number {
		if (!iso) return 0;
		const t = Date.parse(iso);
		return Number.isNaN(t) ? 0 : t;
	}

	const FEED_THESIS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

	let feedItems = $derived.by<FeedItem[]>(() => {
		if (typeof window === 'undefined') return [];
		userIdTick();
		const userId = getUserId();
		const items: FeedItem[] = [];

		for (const g of updatesStore.groups) {
			if (updatesStore.dismissed.has(g.thesis_id)) continue;
			items.push({ kind: 'update_group', at: g.last_at, sortKey: tsOf(g.last_at), group: g });
		}

		const now = Date.now();
		const hasInterests = interestsStore.hasInterests;
		for (const t of allTheses) {
			if (userId && t.meta.author_id === userId) continue;
			if (alreadyVoted.has(t.id)) continue;
			if (justVotedRemoved.has(t.id)) continue;
			const created = tsOf(t.meta.created_at);
			if (created > 0 && now - created > FEED_THESIS_MAX_AGE_MS) continue;
			if (hasInterests && !matchesInterests(t)) continue;
			items.push({ kind: 'new_thesis', at: t.meta.created_at, sortKey: created, thesis: t });
		}

		items.sort((a, b) => b.sortKey - a.sortKey);
		return items;
	});

	// ---- Feed paging ----
	const FEED_PAGE = 20;
	let feedShown = $state(FEED_PAGE);
	let feedPage = $derived(feedItems.slice(0, feedShown));

	// ---- Feed time grouping ----
	interface FeedGroup {
		key: string;
		label: string;
		items: FeedItem[];
	}

	function startOfDay(d: Date): number {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	}

	let feedGroups = $derived.by<FeedGroup[]>(() => {
		const now = new Date();
		const todayStart = startOfDay(now);
		const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
		const out: FeedGroup[] = [];
		const byKey = new Map<string, FeedGroup>();
		for (const it of feedPage) {
			const d = new Date(it.sortKey);
			const t = it.sortKey;
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
				g = { key, label, items: [] };
				byKey.set(key, g);
				out.push(g);
			}
			g.items.push(it);
		}
		return out;
	});

	function markGroupRead(g: UpdateGroup) {
		if (!g.read) updatesStore.markGroupRead(g);
	}

	let showFeed = $derived(!selectedFilter && !selectedHashtag && !isSearching);

	let visibleTheses = $derived.by(() => {
		let filtered = allTheses;
		if (selectedFilter) filtered = filtered.filter((t) => t.categories.includes(selectedFilter!));
		if (selectedHashtag) filtered = filtered.filter((t) => (t.hashtags ?? []).includes(selectedHashtag!));
		filtered = filtered.filter((t) => !alreadyVoted.has(t.id));
		return filtered.slice(0, complexityStore.settings.max_theses);
	});

	let filteredTotal = $derived.by(() => {
		let filtered = allTheses;
		if (selectedFilter) filtered = filtered.filter((t) => t.categories.includes(selectedFilter!));
		if (selectedHashtag) filtered = filtered.filter((t) => (t.hashtags ?? []).includes(selectedHashtag!));
		filtered = filtered.filter((t) => !alreadyVoted.has(t.id));
		return filtered.length;
	});

	// ---- Form visibility ----
	let showForm = $state(false);

	// ---- Suggestion banner state ----
	let suggestedCategories = $state<Category[]>([]);
	let suggestedForThesis = $state<{ id: string; currentCategories: Category[] } | null>(null);

	async function applySuggested() {
		if (!suggestedForThesis) {
			suggestedCategories = [];
			return;
		}
		const merged = Array.from(new Set([...suggestedForThesis.currentCategories, ...suggestedCategories]));
		try {
			const res = await fetch(`/api/theses/${suggestedForThesis.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ categories: merged })
			});
			if (res.ok) {
				const updated = await res.json();
				allTheses = allTheses.map((t) => (t.id === updated.id ? updated : t));
			}
		} finally {
			suggestedCategories = [];
			suggestedForThesis = null;
		}
	}

	function onThesisCreated(thesis: Thesis) {
		allTheses = [thesis, ...allTheses];
	}
</script>

<section class="page">
	<!-- Editorial masthead -->
	<header class="masthead">
		<h1 class="masthead-title">{m.home_masthead_title()}</h1>
		<p class="masthead-sub">{m.home_masthead_sub()}</p>
	</header>

	{#if interestsStore.hasInterests}
		<div class="interests-bar">
			<span class="interests-label">{m.home_interests_following()}</span>
			{#each interestsStore.categories as cat}
				<button class="interest-chip" onclick={() => interestsStore.toggleCategory(cat)} title={m.home_interests_remove()}>
					{cat} <span class="interest-chip-x">×</span>
				</button>
			{/each}
			{#each interestsStore.hashtags as tag}
				<button class="interest-chip" onclick={() => interestsStore.toggleHashtag(tag)} title={m.home_interests_remove()}>
					#{tag} <span class="interest-chip-x">×</span>
				</button>
			{/each}
		</div>
	{/if}

	<SearchBox
		bind:query={searchQuery}
		bind:results={searchResults}
		bind:mode={searchMode}
		bind:searching
	/>

	{#if suggestedCategories.length > 0}
		<div class="suggestion-banner">
			<span class="suggestion-label">{m.home_suggestion_label()}</span>
			{#each suggestedCategories as cat}
				<span class="suggestion-cat">{cat}</span>
			{/each}
			<button class="btn btn-sm suggestion-apply" onclick={applySuggested}>{m.home_suggestion_apply()}</button>
			<button class="suggestion-dismiss" aria-label={m.home_suggestion_dismiss_aria()} onclick={() => { suggestedCategories = []; suggestedForThesis = null; }}>×</button>
		</div>
	{/if}

	{#if isSearching}
		<!-- Search results -->
		<div class="section">
			<div class="section-head">
				<span class="section-filter-active">
					{searchMode === 'semantic' ? m.home_search_mode_semantic() : searchMode === 'fulltext' ? m.home_search_mode_fulltext() : m.home_search_mode_combined()}
				</span>
				<span class="section-meta">{m.home_search_hits({ count: searchResults.length })}</span>
			</div>
			{#if searchResults.length > 0}
				<div class="grid grid-2">
					{#each searchResults as thesis (thesis.id)}
						<ThesisCard {thesis} heatRatio={heat[thesis.id] ?? 0} argumentCount={argumentCounts[thesis.id] ?? 0} />
					{/each}
				</div>
			{:else if !searching}
				<p class="empty-state">{m.home_search_no_matches({ query: searchQuery })}</p>
			{/if}
		</div>
	{:else}
		<!-- Category drill-down tiles -->
		<div class="section">
			<div class="section-head">
				<h2 class="section-title">{m.home_filter_title()}</h2>
				{#if selectedFilter || selectedHashtag}
					{@const isFollowed = selectedFilter ? interestsStore.categories.includes(selectedFilter) : selectedHashtag ? interestsStore.hashtags.includes(selectedHashtag) : false}
					<button
						class="follow-toggle"
						class:following={isFollowed}
						onclick={() => {
							if (selectedFilter) interestsStore.toggleCategory(selectedFilter);
							else if (selectedHashtag) interestsStore.toggleHashtag(selectedHashtag);
							interestsStore.markChosen();
						}}
					>
						{isFollowed ? m.home_interests_unfollow() : m.home_interests_follow()}
					</button>
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

		<Popup open={showForm} variant="modal" cardClass="create-thesis-card" backdropClose={false} onclose={() => { showForm = false; }}>
			<CreateThesisForm
				bind:suggestedCategories
				bind:suggestedForThesis
				oncreated={onThesisCreated}
				onclose={() => { showForm = false; }}
				onapplysuggested={applySuggested}
				ondismisssuggested={() => { suggestedCategories = []; suggestedForThesis = null; }}
			/>
		</Popup>

		{#if showFeed}
			<div class="section">
				<FeedList
					{feedGroups}
					{feedItems}
					{feedShown}
					{heat}
					{argumentCounts}
					{justVotedFadingOut}
					onnote={noteJustVoted}
					onmarkread={markGroupRead}
					ondismiss={(g) => updatesStore.dismissGroup(g)}
					onloadmore={() => (feedShown += FEED_PAGE)}
				/>
			</div>
		{:else}
			<!-- Filtered plain thesis list -->
			<div class="section">
				<div class="section-head">
					{#if selectedFilter || selectedHashtag}
						<span class="section-filter-active">
							{#if selectedFilter}{selectedFilter}{/if}{#if selectedFilter && selectedHashtag} · {/if}{#if selectedHashtag}#{selectedHashtag}{/if}
						</span>
					{/if}
					<span class="section-meta">
						{m.home_list_count({ visible: visibleTheses.length, total: filteredTotal })}
					</span>
				</div>

				<div class="grid grid-2">
					{#each visibleTheses as thesis (thesis.id)}
						<ThesisCard {thesis} heatRatio={heat[thesis.id] ?? 0} argumentCount={argumentCounts[thesis.id] ?? 0} />
					{/each}
				</div>

				{#if visibleTheses.length === 0}
					<div class="feed-refresh">
						<p class="empty-state">
							{m.home_list_empty_filtered({ category: selectedFilter ?? `#${selectedHashtag}` })}
						</p>
					</div>
				{/if}

				{#if filteredTotal > visibleTheses.length}
					<p class="limit-note">
						{m.complexity_slider_hint()}
					</p>
				{/if}
			</div>
		{/if}
	{/if}
</section>

<style>
	/* New-thesis modal: the creation form is far taller/wider than the default
	   Popup card, so widen it. Lives inside Popup, hence :global. */
	:global(.create-thesis-card) {
		width: min(94vw, 34rem);
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.masthead {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-bottom: 0.5rem;
	}

	.interests-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.interests-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-light);
	}

	.interest-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.6rem;
		font-size: var(--text-xs);
		font-family: inherit;
		background: var(--color-primary-bg);
		color: var(--color-primary);
		border: 1px solid var(--color-primary);
		border-radius: 999px;
		cursor: pointer;
	}

	.interest-chip-x {
		font-weight: 700;
		opacity: 0.7;
	}

	.interest-chip:hover .interest-chip-x {
		opacity: 1;
	}

	.follow-toggle {
		font-size: var(--text-xs);
		font-family: inherit;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--color-primary);
		background: var(--color-surface);
		color: var(--color-primary);
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.follow-toggle:hover {
		background: var(--color-primary-bg);
	}

	.follow-toggle.following {
		background: var(--color-primary);
		color: white;
	}

	.masthead-title {
		font-family: var(--font-serif);
		font-size: clamp(2rem, 5vw, 3rem);
		font-weight: 600;
		line-height: 1.05;
		letter-spacing: -0.02em;
		color: var(--color-text);
		margin: 0;
	}

	.masthead-sub {
		font-size: var(--text-lg);
		color: var(--color-text-muted);
		line-height: 1.5;
		margin: 0;
		max-width: 52ch;
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
		background: #ecfeff;
		border: 1px solid #a5f3fc;
		color: #0e7490;
		border-radius: 9999px;
		padding: 0.15rem 0.6rem;
		font-family: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
		transition: all var(--transition-fast);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.hashtag-chip:hover:not(.active) {
		background: #cffafe;
		border-color: #22d3ee;
	}

	.hashtag-chip.active {
		background: #0e7490;
		border-color: #0e7490;
		color: white;
	}

	.hashtag-chip.active .hashtag-count {
		color: rgba(255, 255, 255, 0.85);
	}

	.hashtag-count {
		font-size: 0.85em;
		font-family: var(--font-mono);
		color: rgba(14, 116, 144, 0.6);
	}

	.empty-state {
		text-align: center;
		color: var(--color-text-muted);
		padding: 2rem 1rem;
		font-size: var(--text-base);
	}

	.feed-refresh {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1.5rem 1rem;
		text-align: center;
	}

	.limit-note {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--color-text-light);
		padding: 0.25rem;
		margin: 0;
	}

	/* Category suggestion banner */
	.suggestion-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		background: var(--color-primary-bg, color-mix(in srgb, var(--color-primary) 8%, transparent));
		border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
		font-size: var(--text-sm);
	}

	.suggestion-label {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.suggestion-cat {
		background: var(--color-primary);
		color: white;
		font-size: var(--text-xs);
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		text-transform: capitalize;
	}

	.suggestion-apply {
		margin-left: auto;
	}

	.suggestion-dismiss {
		background: none;
		border: none;
		color: var(--color-text-light);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0.125rem 0.25rem;
		border-radius: var(--radius-sm);
	}

	.suggestion-dismiss:hover {
		color: var(--color-text);
	}
</style>
