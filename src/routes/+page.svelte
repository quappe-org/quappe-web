<script lang="ts">
	import type { Thesis, Category } from '$lib/models/types';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
	import { activityStore } from '$lib/stores/activity.svelte';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { uiIntents } from '$lib/stores/ui.svelte';
	import { getUserId } from '$lib/stores/user';
	import { interestsStore } from '$lib/stores/interests.svelte';
	import { updatesStore, type UpdateEvent } from '$lib/stores/updates.svelte';
	import ThesisCard from '$lib/components/ThesisCard.svelte';
	import ScrollSentinel from '$lib/components/ScrollSentinel.svelte';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	onMount(() => {
		// The landing page IS the feed now — pull the user's updates so they
		// merge into the chronological stream below.
		updatesStore.refresh();
	});

	// svelte-ignore state_referenced_locally
	let allTheses = $state<Thesis[]>(data.theses ?? []);
	// svelte-ignore state_referenced_locally
	let heat = $state<Record<string, number>>(data.heat ?? {});
	// svelte-ignore state_referenced_locally
	let argumentCounts = $state<Record<string, number>>(data.argumentCounts ?? {});
	$effect(() => {
		allTheses = data.theses;
		heat = data.heat ?? {};
		argumentCounts = data.argumentCounts ?? {};
		activityStore.set([], '');
	});

	// Frozen set of theses the user had ALREADY voted on at page load. We hide
	// only these; anything voted DURING the session stays put. The set is only
	// refreshed on an explicit "load more" (refreshFeed), never live — so the
	// list never rearranges under the user's hands.
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

	// Listen for external "new thesis" intent (from sidebar button)
	let _lastSeenIntent = $state(0);
	$effect(() => {
		const count = uiIntents.openNewThesis;
		if (count > _lastSeenIntent) {
			_lastSeenIntent = count;
			showForm = true;
			setTimeout(() => {
				document.querySelector('.create-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}, 50);
		}
	});

	// ---- Search ----
	let searchQuery = $state('');
	let searchResults = $state<Thesis[]>([]);
	let searchMode = $state<'semantic' | 'fulltext' | 'combined' | 'empty' | null>(null);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	function onSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		const q = searchQuery.trim();
		if (q.length < 2) {
			searchResults = [];
			searchMode = null;
			return;
		}
		searchTimer = setTimeout(async () => {
			searching = true;
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
				if (res.ok) {
					const data = await res.json();
					searchResults = data.results ?? [];
					searchMode = data.mode ?? null;
				}
			} finally {
				searching = false;
			}
		}, 300);
	}

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

	// Does a thesis match the user's followed interests (category or hashtag)?
	function matchesInterests(t: Thesis): boolean {
		if (!interestsStore.hasInterests) return false;
		for (const c of t.categories) if (interestsStore.categories.includes(c)) return true;
		for (const h of t.hashtags ?? []) if (interestsStore.hashtags.includes(h)) return true;
		return false;
	}

	// ---- Merged personalized feed (default, no-filter view) ----
	// Combines the user's updates (forks / new arguments / lifecycle) with fresh
	// theses matching their followed interests, sorted newest-first.
	type FeedItem =
		| { kind: 'update'; at: string; sortKey: number; event: UpdateEvent }
		| { kind: 'new_thesis'; at: string; sortKey: number; thesis: Thesis };

	function tsOf(iso: string | undefined): number {
		if (!iso) return 0;
		const t = Date.parse(iso);
		return Number.isNaN(t) ? 0 : t;
	}

	// "Recent-ish" horizon for new theses surfacing in the feed (30 days).
	const FEED_THESIS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

	let feedItems = $derived.by<FeedItem[]>(() => {
		if (typeof window === 'undefined') return [];
		const userId = getUserId();
		const items: FeedItem[] = [];

		// (a) Updates the user cares about.
		for (const e of updatesStore.events) {
			items.push({ kind: 'update', at: e.at, sortKey: tsOf(e.at), event: e });
		}

		// (b) New theses matching interests (or, if no interests, recent theses
		// generally). Exclude the user's own and anything they've voted on.
		const now = Date.now();
		const hasInterests = interestsStore.hasInterests;
		for (const t of allTheses) {
			if (t.meta.author_id === userId) continue;
			if (t.votes.some((v) => v.user_id === userId)) continue;
			const created = tsOf(t.meta.created_at);
			if (created > 0 && now - created > FEED_THESIS_MAX_AGE_MS) continue;
			if (hasInterests && !matchesInterests(t)) continue;
			items.push({ kind: 'new_thesis', at: t.meta.created_at, sortKey: created, thesis: t });
		}

		items.sort((a, b) => b.sortKey - a.sortKey);
		return items;
	});

	// ---- Feed paging (infinite scroll) ----
	const FEED_PAGE = 20;
	let feedShown = $state(FEED_PAGE);
	let feedPage = $derived(feedItems.slice(0, feedShown));

	// ---- Feed time grouping (Today / This week / "Month YYYY") ----
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

	// ---- Feed update-item helpers (mirrors /my/updates markup) ----
	function updateTypeLabel(kind: UpdateEvent['kind']): string {
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

	function markUpdateRead(e: UpdateEvent) {
		if (!e.read) updatesStore.markRead([e.event_key]);
	}

	function keepOriginal(e: UpdateEvent) {
		markUpdateRead(e);
	}

	async function switchToFork(e: UpdateEvent) {
		markUpdateRead(e);
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

	// Feed is the default view; a filter switches to the plain thesis list.
	let showFeed = $derived(!selectedFilter && !selectedHashtag && !isSearching);

	let visibleTheses = $derived.by(() => {
		let filtered = allTheses;
		if (selectedFilter) filtered = filtered.filter((t) => t.categories.includes(selectedFilter!));
		if (selectedHashtag) filtered = filtered.filter((t) => (t.hashtags ?? []).includes(selectedHashtag!));
		// Hide only theses the user had ALREADY voted on at load — voting now
		// keeps the thesis visible until the next reload (no mid-click vanish).
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

	// ---- Thesis form ----
	let showForm = $state(false);
	let title = $state('');
	let description = $state('');
	let selectedCategories = $state<Category[]>([]);
	let suggestedCategories = $state<Category[]>([]);
	let suggestedForThesis = $state<{ id: string; currentCategories: Category[] } | null>(null);
	let submitting = $state(false);
	let createError = $state<string | null>(null);

	// Optional author-provided readability registers (prose = the fields above).
	// Only the DESCRIPTION gets variants — the title stays canonical.
	let showVariants = $state(false);
	let descriptionSimple = $state('');
	let descriptionDense = $state('');
	let drafting = $state(false);

	// LLM draft helper: fills BOTH registers from the current title/description.
	// The author reviews/edits the result before it is saved — meaning stays theirs.
	async function draftVariants() {
		if (!title.trim() || !description.trim()) return;
		drafting = true;
		try {
			const [simpleRes, denseRes] = await Promise.all([
				fetch('/api/theses/draft-variant', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: title.trim(), description: description.trim(), variant: 'simple' })
				}),
				fetch('/api/theses/draft-variant', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: title.trim(), description: description.trim(), variant: 'dense' })
				})
			]);
			if (simpleRes.ok) {
				const d = (await simpleRes.json()) as { description: string };
				descriptionSimple = d.description;
			}
			if (denseRes.ok) {
				const d = (await denseRes.json()) as { description: string };
				descriptionDense = d.description;
			}
		} finally {
			drafting = false;
		}
	}

	// Live "already exists?" hint while the user is typing the new thesis
	let similarExisting = $state<Thesis[]>([]);
	let similarLoading = $state(false);
	let similarTimer: ReturnType<typeof setTimeout> | null = null;
	let similarSeq = 0;

	function onFormTyping() {
		if (similarTimer) clearTimeout(similarTimer);
		const combined = `${title.trim()} ${description.trim()}`.trim();
		if (combined.length < 8) {
			similarExisting = [];
			similarLoading = false;
			return;
		}
		similarLoading = true;
		const mySeq = ++similarSeq;
		similarTimer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/theses/similar?q=${encodeURIComponent(combined)}`);
				if (!res.ok) return;
				const payload = await res.json();
				if (mySeq !== similarSeq) return;
				similarExisting = (payload.results ?? []).slice(0, 3);
			} finally {
				if (mySeq === similarSeq) similarLoading = false;
			}
		}, 400);
	}

	function toggleCategory(cat: Category) {
		if (selectedCategories.includes(cat)) {
			selectedCategories = selectedCategories.filter((c) => c !== cat);
		} else {
			selectedCategories = [...selectedCategories, cat];
		}
	}

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
				body: JSON.stringify({ categories: merged, user_id: getUserId() })
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

	async function createThesis() {
		if (!title.trim() || !description.trim()) return;
		if (!budgetStore.canCreateThesis()) {
			createError = m.error_thesis_limit_reached();
			return;
		}
		budgetStore.spendThesis();
		submitting = true;
		createError = null;
		// Server requires ≥1 category. If the user didn't pick, fall back to
		// 'other' up-front — the LLM suggestion (if confident) will replace it
		// via the PUT below.
		const payloadCategories = selectedCategories.length > 0 ? selectedCategories : ['other'];
		try {
			const res = await fetch('/api/theses', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: title.trim(),
					description: description.trim(),
					categories: payloadCategories,
					description_simple: descriptionSimple.trim() || undefined,
					description_dense: descriptionDense.trim() || undefined,
					author_id: getUserId()
				})
			});
			if (!res.ok) {
				budgetStore.refundThesis();
				if (res.status === 429) {
					createError = m.error_too_many_requests();
				} else if (res.status === 413) {
					createError = m.error_text_too_long();
				} else if (res.status === 400) {
					const body = await res.json().catch(() => ({}));
					createError = body?.error ?? m.error_invalid_input();
				} else {
					createError = m.error_server_generic({ status: res.status });
				}
				return;
			}
			const responseData = await res.json();
			const suggested: Category[] = responseData.suggested_categories ?? [];
			const currentCats = [...selectedCategories];

			// If the user picked no categories, auto-apply the server's suggestion
			// before showing the thesis in the list — this is what "just submit" expects.
			// Skip the PUT when the suggestion is just ['other'] (no confidence) since
			// the initial payload already defaulted to that.
			let finalThesis: Thesis = responseData;
			const suggestionIsFallback = suggested.length === 1 && suggested[0] === 'other';
			if (currentCats.length === 0 && suggested.length > 0 && !suggestionIsFallback) {
				try {
					const putRes = await fetch(`/api/theses/${responseData.id}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ categories: suggested, user_id: getUserId() })
					});
					if (putRes.ok) finalThesis = await putRes.json();
				} catch {
					// fall through with uncategorized thesis
				}
			}

			allTheses = [finalThesis, ...allTheses];

			// Banner: only show if the suggestion adds something the user did NOT
			// pick. If we already auto-applied above (empty selection), skip.
			if (currentCats.length > 0) {
				const novel = suggested.filter((c) => !currentCats.includes(c));
				if (novel.length > 0) {
					suggestedCategories = novel;
					suggestedForThesis = { id: finalThesis.id, currentCategories: currentCats };
				} else {
					suggestedCategories = [];
					suggestedForThesis = null;
				}
			} else {
				suggestedCategories = [];
				suggestedForThesis = null;
			}

			title = '';
			description = '';
			selectedCategories = [];
			similarExisting = [];
			descriptionSimple = '';
			descriptionDense = '';
			showVariants = false;
			showForm = false;
		} catch (err) {
			budgetStore.refundThesis();
			createError = m.error_server_generic({ status: 0 });
		} finally {
			submitting = false;
		}
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

	<!-- Search -->
	<div class="search-wrap">
		<div class="search-box">
			<svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
			<input
				type="search"
				class="search-input"
				placeholder={m.home_search_placeholder()}
				bind:value={searchQuery}
				oninput={onSearchInput}
				maxlength="200"
			/>
			{#if searching}
				<span class="search-spinner" aria-label={m.home_search_searching_aria()}></span>
			{/if}
		</div>
	</div>

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

		{#if showForm}
			<form class="card create-form" onsubmit={(e) => { e.preventDefault(); createThesis(); }}>
				<div class="form-header">
					<h2 class="form-title">{m.home_create_title()}</h2>
					<button
						type="button"
						class="form-close"
						aria-label={m.home_create_close_aria()}
						title={m.home_create_close_aria()}
						onclick={() => { showForm = false; similarExisting = []; createError = null; }}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
					</button>
				</div>

				<div class="form-group">
					<label for="thesis-title">{m.home_create_title_label()}</label>
					<input id="thesis-title" type="text" bind:value={title} oninput={onFormTyping} placeholder={m.home_create_title_placeholder()} maxlength="200" required />
				</div>

				{#if similarLoading || similarExisting.length > 0}
					<div class="similar-existing">
						<div class="similar-head">
							<span class="similar-label">{m.home_create_similar_label()}</span>
							{#if similarLoading}
								<span class="search-spinner" aria-label={m.home_search_searching_aria()}></span>
							{/if}
						</div>
						{#if similarExisting.length > 0}
							<ul class="similar-list">
								{#each similarExisting as ex (ex.id)}
									<li>
										<a class="similar-link" href="/thesis/{ex.id}" target="_blank" rel="noopener">
											<span class="similar-thesis-title">{ex.title}</span>
											<span class="similar-cats">
												{#each ex.categories.slice(0, 3) as cat}
													<span class="similar-cat">{cat}</span>
												{/each}
											</span>
										</a>
									</li>
								{/each}
							</ul>
						{:else if !similarLoading}
							<p class="similar-empty">{m.home_create_similar_empty()}</p>
						{/if}
					</div>
				{/if}

				<div class="form-group">
					<label for="thesis-desc">{m.home_create_desc_label()}</label>
					<textarea id="thesis-desc" bind:value={description} oninput={onFormTyping} placeholder={m.home_create_desc_placeholder()} maxlength="2000" required></textarea>
				</div>

				<div class="form-group">
					<label for="thesis-categories">
						{m.home_create_categories_label()}
						<span class="hint-inline">{m.home_create_categories_hint()}</span>
					</label>
					<div class="category-grid" id="thesis-categories">
						{#each categoriesStore.list as cat}
							<button
								type="button"
								class="tag category-btn"
								class:selected={selectedCategories.includes(cat)}
								onclick={() => toggleCategory(cat)}
							>{cat}</button>
						{/each}
					</div>
				</div>

				<div class="variants-section">
					<button type="button" class="variants-toggle" onclick={() => (showVariants = !showVariants)} aria-expanded={showVariants}>
						<svg class="variants-chevron" class:open={showVariants} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
						{m.home_create_variants_toggle()}
					</button>
					{#if showVariants}
						<p class="variants-hint">{m.home_create_variants_hint()}</p>
						<div class="variant-draft-row">
							<button type="button" class="variant-draft-btn" disabled={drafting || !title.trim() || !description.trim()} onclick={draftVariants}>
								{drafting ? m.home_create_variants_drafting() : m.home_create_variants_draft()}
							</button>
						</div>

						<div class="variant-block">
							<span class="variant-block-title">{m.rephrase_simple()}</span>
							<textarea bind:value={descriptionSimple} placeholder={m.home_create_desc_placeholder()} maxlength="2000" rows="2"></textarea>
						</div>

						<div class="variant-block">
							<span class="variant-block-title">{m.rephrase_dense()}</span>
							<textarea bind:value={descriptionDense} placeholder={m.home_create_desc_placeholder()} maxlength="2000" rows="2"></textarea>
						</div>
					{/if}
				</div>

				<div class="form-actions">
					<button class="btn btn-primary" type="submit" disabled={submitting}>
						{submitting ? m.home_create_submitting() : m.home_create_submit()}
					</button>
					<button class="btn" type="button" onclick={() => { showForm = false; similarExisting = []; createError = null; }}>{m.home_create_cancel()}</button>
				</div>

				{#if createError}
					<p class="create-error" role="alert">{createError}</p>
				{/if}
			</form>
		{/if}

		{#if showFeed}
			<!-- Personalized feed: merged updates + new theses, newest first -->
			<div class="section">
				{#if feedItems.length === 0}
					<div class="feed-empty card">
						<p><strong>{m.feed_empty_head()}</strong></p>
						<p>{m.feed_empty_body()}</p>
					</div>
				{:else}
					{#each feedGroups as group (group.key)}
						<div class="time-divider">{group.label}</div>
						<div class="feed-list">
							{#each group.items as item (item.kind === 'update' ? `u:${item.event.event_key}` : `t:${item.thesis.id}`)}
								{#if item.kind === 'new_thesis'}
									<div class="feed-thesis">
										<span class="feed-new-badge">{m.feed_new_thesis_badge()}</span>
										<ThesisCard
											thesis={item.thesis}
											heatRatio={heat[item.thesis.id] ?? 0}
											argumentCount={argumentCounts[item.thesis.id] ?? 0}
										/>
									</div>
								{:else}
									{@const e = item.event}
									<div class="updates-item card updates-{e.kind}" class:is-read={e.read}>
										<div class="updates-item-row">
											<span class="updates-type updates-type-{e.kind}">{updateTypeLabel(e.kind)}</span>
											<time class="updates-time">{fmtTime(e.at)}</time>
											{#if e.kind === 'lifecycle' && e.lifecycle_state}
												<span class="updates-lifecycle-state">{e.lifecycle_state}</span>
											{/if}
											<a class="updates-thesis" href="/thesis/{e.thesis_id}" onclick={() => markUpdateRead(e)}>{e.thesis_title}</a>
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
									</div>
								{/if}
							{/each}
						</div>
					{/each}

					{#if feedItems.length > feedShown}
						<ScrollSentinel onVisible={() => (feedShown += FEED_PAGE)} />
						<div class="feed-refresh">
							<button class="btn btn-sm" onclick={() => (feedShown += FEED_PAGE)}>{m.my_load_more()}</button>
						</div>
					{/if}
				{/if}
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
	.page {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Editorial masthead */
	.masthead {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-bottom: 0.5rem;
	}

	/* Followed-interests bar */
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

	/* Category chips - horizontal scrollable, no wrapping */
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

	/* Hashtag chips - second filter row below categories */
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

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form-actions {
		display: flex;
		gap: 0.5rem;
	}

	/* Optional reading variants */
	.variants-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-top: 1px solid var(--color-border);
		padding-top: 0.85rem;
	}

	.variants-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		padding: 0;
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		align-self: flex-start;
	}

	.variants-toggle:hover {
		color: var(--color-text);
	}

	.variants-chevron {
		transition: transform var(--transition-fast);
	}
	.variants-chevron.open {
		transform: rotate(90deg);
	}

	.variants-hint {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		line-height: 1.5;
		margin: 0;
	}

	.variant-block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.variant-draft-row {
		display: flex;
		justify-content: flex-end;
	}

	.variant-block-title {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.variant-draft-btn {
		font-family: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-primary);
		border: 1px solid var(--color-primary);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.variant-draft-btn:hover:not(:disabled) {
		background: var(--color-primary);
		color: #fff;
	}

	.variant-draft-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.create-error {
		margin: 0;
		padding: 0.5rem 0.75rem;
		background: var(--color-reject-bg);
		border: 1px solid var(--color-reject);
		border-radius: var(--radius-md);
		color: var(--color-reject);
		font-size: var(--text-sm);
	}

	.form-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.form-title {
		font-size: var(--text-lg);
		font-weight: 600;
		margin: 0;
	}

	.form-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.form-close:hover {
		background: var(--color-reject-bg);
		border-color: var(--color-reject);
		color: var(--color-reject);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.category-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.category-btn {
		cursor: pointer;
		border: 1px solid var(--color-border);
		transition: all var(--transition-fast);
	}

	.category-btn.selected {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
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

	/* ---- Personalized feed ---- */
	.feed-empty {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1.5rem 1rem;
	}
	.feed-empty p:first-child {
		font-size: var(--text-base);
	}
	.feed-empty p:last-child {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.time-divider {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-light);
		padding: 0.5rem 0 0.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.feed-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.feed-thesis {
		position: relative;
	}

	.feed-new-badge {
		position: absolute;
		top: -0.5rem;
		left: 0.75rem;
		z-index: 1;
		background: var(--color-primary);
		color: white;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		box-shadow: var(--shadow-sm);
	}

	/* Update items (mirror /my/updates styling) */
	.updates-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		position: relative;
		padding: 0.75rem 1rem;
		border-left: 3px solid transparent;
		transition: opacity var(--transition-base);
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

	.limit-note {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--color-text-light);
		padding: 0.25rem;
		margin: 0;
	}

	/* Search */
	.search-wrap {
		position: relative;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.85rem 1.1rem;
		box-shadow: var(--shadow-sm);
		transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
	}

	.search-box:focus-within {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px var(--color-primary-bg);
	}

	.search-icon {
		color: var(--color-text-light);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: var(--text-lg);
		color: var(--color-text);
		outline: none;
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--color-text-light);
	}

	.search-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
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

	.hint-inline {
		font-weight: 400;
		font-size: 0.7rem;
		color: var(--color-text-light);
		margin-left: 0.4rem;
		text-transform: none;
		letter-spacing: 0;
	}

	/* Similar-existing-thesis hint inside the create form */
	.similar-existing {
		background: var(--color-bg);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.similar-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.similar-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.similar-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.similar-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.35rem 0.4rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--color-text);
		transition: background var(--transition-fast);
	}

	.similar-link:hover {
		background: var(--color-surface);
	}

	.similar-thesis-title {
		font-size: var(--text-sm);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.similar-cats {
		display: flex;
		gap: 0.2rem;
		flex-shrink: 0;
	}

	.similar-cat {
		font-size: 0.65rem;
		font-family: var(--font-mono);
		color: var(--color-text-light);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		padding: 0.05rem 0.4rem;
		text-transform: capitalize;
	}

	.similar-empty {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		margin: 0;
	}
</style>
