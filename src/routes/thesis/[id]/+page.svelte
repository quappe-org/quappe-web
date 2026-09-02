<script lang="ts">
	import type { Argument, VoteType, VoteSummary, Category, Thesis, ThesisEdgeHydrated } from '$lib/models/types';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
	import { activityStore } from '$lib/stores/activity.svelte';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { getUserId, markVotedArg } from '$lib/stores/user';
	import { forkFeedStore } from '$lib/stores/fork-feed.svelte';
	import { abbreviateNumber } from '$lib/utils/format';
	import VoteRow from '$lib/components/VoteRow.svelte';
	import SwipeVote from '$lib/components/SwipeVote.svelte';
	import ActivityGraph from '$lib/components/ActivityGraph.svelte';
	import LifecycleIcon from '$lib/components/LifecycleIcon.svelte';
	import ArgumentForm from '$lib/components/ArgumentForm.svelte';
	import ArgumentColumns from '$lib/components/ArgumentColumns.svelte';
	import Popup from '$lib/components/Popup.svelte';
	import type { ActivityDay } from '$lib/models/contract';
	import { m } from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { localeStore } from '$lib/stores/locale.svelte';
	import { registerForComplexity, pickDescription } from '$lib/models/variants';
	import { nextFibWeight } from '$lib/models/fibonacci';
	import { onMount } from 'svelte';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let thesis = $state<any>(data.thesis);
	// svelte-ignore state_referenced_locally
	let args = $state<Argument[]>(data.arguments ?? []);
	// svelte-ignore state_referenced_locally
	let voteSummary = $state<VoteSummary | null>(data.voteSummary ?? null);
	// svelte-ignore state_referenced_locally
	let related = $state(data.related ?? []);
	// svelte-ignore state_referenced_locally
	let relatedMode = $state<string | null>(data.relatedMode ?? null);
	// svelte-ignore state_referenced_locally
	let activity = $state<ActivityDay[]>(data.activity ?? []);
	// svelte-ignore state_referenced_locally
	let heatRatio = $state<number>(data.heatRatio ?? 0);
	// svelte-ignore state_referenced_locally
	let linkedTheses = $state<ThesisEdgeHydrated[]>(data.linkedTheses ?? []);

	$effect(() => {
		thesis = data.thesis;
		args = data.arguments;
		voteSummary = data.voteSummary;
		related = data.related ?? [];
		relatedMode = data.relatedMode ?? null;
		activity = data.activity ?? [];
		heatRatio = data.heatRatio ?? 0;
		linkedTheses = data.linkedTheses ?? [];
		activityStore.set([], '');
		if (data.arguments && data.thesis) {
			forkFeedStore.update(data.arguments, data.thesis.title);
		}
	});

	let heat = $derived.by(() => {
		if (heatRatio >= 1.5) return 'hot';
		if (heatRatio >= 0.75) return 'warm';
		if (heatRatio > 0) return 'cool';
		return 'cold';
	});

	let visibleRelated = $derived(related.slice(0, complexityStore.settings.max_related));

	let isAuthor = $derived.by(() => {
		if (typeof window === 'undefined' || !thesis) return false;
		return getUserId() === thesis.meta.author_id;
	});

	// --- Argument groups (fork families) ---
	interface ArgGroup {
		root: Argument;
		variants: Argument[];
		all: Argument[];
		groupScore: number;
	}

	let argIndex = $derived.by(() => {
		const map = new Map<string, Argument>();
		for (const a of args) map.set(a.id, a);
		return map;
	});

	function rootOf(arg: Argument): Argument {
		let root = arg;
		const guard = new Set<string>();
		while (root.forked_from_id && argIndex.has(root.forked_from_id) && !guard.has(root.id)) {
			guard.add(root.id);
			root = argIndex.get(root.forked_from_id)!;
		}
		return root;
	}

	function scoreOf(a: Argument): number {
		let s = 0;
		for (const v of a.votes) {
			const w = v.weight || 1;
			if (v.type === 'support') s += w;
			else if (v.type === 'reject') s -= w;
		}
		return s;
	}

	let argGroups = $derived.by(() => {
		const groups = new Map<string, ArgGroup>();
		for (const a of args) {
			const root = rootOf(a);
			let g = groups.get(root.id);
			if (!g) {
				g = { root, variants: [], all: [], groupScore: 0 };
				groups.set(root.id, g);
			}
		}
		for (const a of args) {
			const root = rootOf(a);
			const g = groups.get(root.id)!;
			g.all.push(a);
			if (a.id !== root.id) g.variants.push(a);
		}
		for (const g of groups.values()) {
			g.groupScore = g.all.reduce((s, a) => s + scoreOf(a), 0);
			g.variants.sort((a, b) => scoreOf(b) - scoreOf(a));
		}
		return [...groups.values()];
	});

	// Frozen display order
	let frozenRank = $state<Map<string, number>>(new Map());

	function recomputeOrder() {
		const ranked = [...argGroups].sort((a, b) => b.groupScore - a.groupScore);
		const map = new Map<string, number>();
		ranked.forEach((g, i) => map.set(g.root.id, i));
		frozenRank = map;
		pendingReorderCount = 0;
	}

	let pendingReorderCount = $state(0);

	function computeCurrentTopIds(count: number): string[] {
		return [...argGroups]
			.sort((a, b) => b.groupScore - a.groupScore)
			.slice(0, count)
			.map((g) => g.root.id);
	}

	$effect(() => {
		if (argGroups.length === 0) {
			if (frozenRank.size === 0) return;
			frozenRank = new Map();
			pendingReorderCount = 0;
			return;
		}
		if (frozenRank.size === 0) {
			recomputeOrder();
			return;
		}
		let newArrivals = 0;
		for (const g of argGroups) {
			if (!frozenRank.has(g.root.id)) newArrivals++;
		}
		const N = Math.min(3, argGroups.length);
		const frozenTop = [...frozenRank.entries()]
			.filter(([, r]) => r < N)
			.map(([id]) => id);
		const liveTop = computeCurrentTopIds(N);
		let scoreDrift = 0;
		const frozenSet = new Set(frozenTop);
		for (const id of liveTop) if (!frozenSet.has(id)) scoreDrift++;
		pendingReorderCount = newArrivals + scoreDrift;
	});

	function byFrozen(a: ArgGroup, b: ArgGroup): number {
		const ra = frozenRank.get(a.root.id) ?? Number.MAX_SAFE_INTEGER;
		const rb = frozenRank.get(b.root.id) ?? Number.MAX_SAFE_INTEGER;
		return ra - rb;
	}

	async function pollVotes() {
		if (typeof window === 'undefined' || !thesis) return;
		if (voting) return;
		try {
			const res = await fetch(`/api/arguments?thesis_id=${thesis.id}`);
			if (!res.ok) return;
			const fresh = (await res.json()) as Argument[];
			const byId = new Map(fresh.map((a) => [a.id, a]));
			const userId = getUserId();
			let appended = false;
			for (const a of args) {
				const f = byId.get(a.id);
				if (f) {
					const mineLocal = a.votes.some((v) => v.user_id === userId);
					const mineFresh = f.votes.some((v) => v.user_id === userId);
					if (!(mineLocal && !mineFresh)) a.votes = f.votes;
					byId.delete(a.id);
				}
			}
			for (const f of byId.values()) {
				args.push(f);
				appended = true;
			}
			if (appended) args = [...args];
		} catch {
			// silent
		}
	}

	onMount(() => {
		loadOpinionGraph();
		const id = setInterval(() => { pollVotes(); loadOpinionGraph(); }, 15_000);
		return () => clearInterval(id);
	});

	let topGroups = $derived.by(() =>
		[...visibleArgGroups].sort(byFrozen).slice(0, complexityStore.settings.max_arguments)
	);

	let poolGroups = $derived.by(() => {
		const topIds = new Set<string>(topGroups.map((g) => g.root.id));
		const rest = visibleArgGroups.filter((g) => !topIds.has(g.root.id)).sort(byFrozen);
		return rest.slice(0, complexityStore.settings.max_arguments * 2);
	});

	let totalArguments = $derived(argGroups.length);

	// --- Opinion view filter ---
	type OpinionView = 'all' | 'supporters' | 'rejecters';
	let opinionView = $state<OpinionView>('all');

	interface ArgApproval {
		argument_id: string;
		by_thesis_support: number;
		by_thesis_reject: number;
		by_thesis_neutral: number;
		by_thesis_none: number;
		total_approvers: number;
	}
	let approvals = $state<Map<string, ArgApproval>>(new Map());

	async function loadOpinionGraph() {
		if (typeof window === 'undefined' || !thesis) return;
		try {
			const res = await fetch(`/api/theses/${thesis.id}/opinion-graph`);
			if (!res.ok) return;
			const data = (await res.json()) as { arguments: ArgApproval[] };
			const m = new Map<string, ArgApproval>();
			for (const a of data.arguments) m.set(a.argument_id, a);
			approvals = m;
		} catch {
			// silent
		}
	}

	function groupMatchesView(g: ArgGroup): boolean {
		if (opinionView === 'all') return true;
		for (const a of g.all) {
			const ap = approvals.get(a.id);
			if (!ap || ap.total_approvers === 0) continue;
			if (opinionView === 'supporters' && ap.by_thesis_support >= ap.by_thesis_reject && ap.by_thesis_support > 0) return true;
			if (opinionView === 'rejecters' && ap.by_thesis_reject >= ap.by_thesis_support && ap.by_thesis_reject > 0) return true;
		}
		return false;
	}

	let visibleArgGroups = $derived.by(() => {
		if (opinionView === 'all') return argGroups;
		return argGroups.filter(groupMatchesView);
	});

	// --- Thesis voting ---
	let voting = $state(false);
	let currentVote = $state<VoteType | null>(null);
	let currentWeight = $state(1);
	let hasVotedLocally = $state(false);

	// Any thesis vote (support/reject/neutral) unlocks contributing arguments —
	// mirrors the server-side thesis_vote_required gate on argument create/fork.
	let hasThesisVote = $derived(currentVote !== null);

	$effect(() => {
		if (typeof window === 'undefined' || !thesis || hasVotedLocally) return;
		const userId = getUserId();
		const existing = thesis.votes?.find((v: any) => v.user_id === userId);
		currentVote = existing ? existing.type : null;
		currentWeight = existing?.weight ?? 1;
	});

	// Centred, auto-dismissing nudge shown when an action needs a thesis vote
	// first (styled like the header modal cards). Brief but readable, then fades.
	let needThesisVoteHint = $state(false);
	let voteHintTimer: ReturnType<typeof setTimeout> | undefined;
	function nudgeThesisVote() {
		needThesisVoteHint = true;
		if (typeof document !== 'undefined') {
			document.querySelector('.thesis-tile')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
		clearTimeout(voteHintTimer);
		voteHintTimer = setTimeout(() => { needThesisVoteHint = false; }, 1800);
	}

	async function castThesisVote(type: VoteType, weight: number) {
		if (voting || !thesis) return;
		const isRetract = currentVote === type && currentWeight === weight;
		const chargeable = !isRetract && (type === 'support' || type === 'reject') && weight > 1;
		if (chargeable) {
			if (!budgetStore.canAffordWeight(weight)) return;
			budgetStore.spendWeight(weight);
		}
		voting = true;
		try {
			const res = await fetch(`/api/theses/${thesis.id}/vote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type, weight })
			});
			if (!res.ok) {
				if (chargeable) budgetStore.refundWeight(weight);
				return;
			}
			const responseData = await res.json();
			voteSummary = responseData.vote_summary;
			const isRetract2 = currentVote === type && currentWeight === weight;
			currentVote = isRetract2 ? null : type;
			currentWeight = isRetract2 ? 1 : weight;
			hasVotedLocally = true;
		} finally {
			voting = false;
		}
	}

	// A directional swipe = a vote in that direction, matching ThesisCard's swipe:
	// if you already hold this stance, the swipe climbs the Fibonacci weight;
	// otherwise it's a fresh weight-1 vote. Keeps swipe identical across views.
	function castThesisSwipe(type: 'support' | 'reject') {
		const weight = currentVote === type ? nextFibWeight(currentWeight) : 1;
		castThesisVote(type, weight);
	}

	// --- Argument form ---
	// Opened declaratively via `argIntent`: setting it (and flipping showArgForm)
	// mounts the form already in the right mode. Driving it through a bound ref
	// was racy — the ref was still null in the tick the form was opened.
	let showArgForm = $state(false);
	let argIntent = $state<import('$lib/components/ArgumentForm.svelte').ArgFormIntent>({ mode: 'new' });

	function openNewArg() {
		argIntent = { mode: 'new' };
		showArgForm = true;
	}

	function openFork(source: Argument) {
		argIntent = { mode: 'fork', source };
		showArgForm = true;
	}

	function openEdit(target: Argument) {
		argIntent = { mode: 'edit', source: target };
		showArgForm = true;
	}

	function onArgSubmitted(arg: Argument, mode: string) {
		if (mode === 'edit') {
			args = args.map((a) => (a.id === arg.id ? arg : a));
		} else {
			args = [...args, arg];
		}
	}

	// --- Linked theses (thesis-as-argument) ---
	// Linking lives inside the argument form's "link a thesis" tab (a thesis IS an
	// argument). The vote-first gate is enforced there and by the server.
	async function onThesisLinked(_source: Thesis) {
		// Refetch so the list carries the real edge ids (needed for unlink) rather
		// than an optimistic placeholder. Cheap — a single small hydrated read.
		const res = await fetch(`/api/theses/${thesis.id}/edges`);
		if (res.ok) {
			const body = await res.json();
			linkedTheses = body.edges ?? [];
		}
	}

	async function unlinkThesis(sourceId: string) {
		const entry = linkedTheses.find((l) => l.edge.source_thesis_id === sourceId);
		if (!entry) return;
		const res = await fetch(`/api/theses/${thesis.id}/edges/${entry.edge.id}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			linkedTheses = linkedTheses.filter((l) => l.edge.source_thesis_id !== sourceId);
		}
	}

	let linkedSourceIds = $derived(linkedTheses.map((l) => l.edge.source_thesis_id));

	// --- Thesis edit ---
	let editingThesis = $state(false);
	let editTitle = $state('');
	let editDescription = $state('');
	let editCategories = $state<Category[]>([]);
	let editSubmitting = $state(false);

	// --- Translation ---
	let translated = $state<{ title: string; description: string } | null>(null);
	let translating = $state(false);
	let translateNeeded = $derived.by(() => {
		if (!thesis?.lang) return false;
		if (!localeStore.current) return false;
		return thesis.lang !== localeStore.current;
	});

	let register = $derived<'simple' | 'prose' | 'dense'>(
		registerForComplexity(complexityStore.settings.max_arguments)
	);
	let baseTitle = $derived(thesis?.title ?? '');
	let baseDescription = $derived(pickDescription(thesis, register));

	let activeVariant = $derived.by<'simple' | 'dense' | null>(() => {
		if (!thesis || translated) return null;
		if (register === 'simple' && thesis.description_simple) return 'simple';
		if (register === 'dense' && thesis.description_dense) return 'dense';
		return null;
	});

	let displayTitle = $derived(translated?.title ?? baseTitle);
	let displayDescription = $derived(translated?.description ?? baseDescription);

	async function toggleTranslate() {
		if (!thesis) return;
		if (translated) { translated = null; return; }
		if (translating) return;
		translating = true;
		try {
			const target = localeStore.current ?? getLocale();
			const res = await fetch(`/api/theses/${thesis.id}/translate?to=${target}`);
			if (!res.ok) return;
			const data = (await res.json()) as { title: string; description: string; target: string };
			translated = { title: data.title, description: data.description };
		} finally {
			translating = false;
		}
	}

	function openEditThesis() {
		if (!thesis) return;
		editTitle = thesis.title;
		editDescription = thesis.description;
		editCategories = [...thesis.categories];
		editingThesis = true;
	}

	function toggleEditCategory(cat: Category) {
		if (editCategories.includes(cat)) editCategories = editCategories.filter((c) => c !== cat);
		else editCategories = [...editCategories, cat];
	}

	async function submitEditThesis() {
		if (!thesis) return;
		editSubmitting = true;
		try {
			const res = await fetch(`/api/theses/${thesis.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: editTitle.trim(),
					description: editDescription.trim(),
					categories: editCategories,
					user_id: getUserId()
				})
			});
			if (res.ok) {
				const updated = await res.json();
				thesis = { ...thesis, ...updated };
				editingThesis = false;
			}
		} finally {
			editSubmitting = false;
		}
	}

	async function toggleArchive() {
		if (!thesis) return;
		const newState = !thesis.archived;
		if (!confirm(newState ? m.thesis_admin_confirm_archive() : m.thesis_admin_confirm_unarchive())) return;
		const res = await fetch(`/api/theses/${thesis.id}/archive`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ archived: newState })
		});
		if (res.ok) {
			const updated = await res.json();
			thesis = { ...thesis, ...updated };
		}
	}
</script>

{#if thesis}
	<article class="thesis-detail" class:archived={thesis.archived}>
		<a href="/" class="back-link">{m.thesis_back()}</a>

		{#if thesis.archived}
			<div class="archived-banner">{m.thesis_archived_banner()}</div>
		{/if}

		<!-- Thesis tile -->
		<SwipeVote
			oncast={castThesisVote}
			onSwipeRight={() => castThesisSwipe('support')}
			onSwipeLeft={() => castThesisSwipe('reject')}
			heldVote={currentVote}
			heldWeight={currentWeight}
		>
		<div class="thesis-tile card heat-{heat}">
			<div class="thesis-eyebrow">
				<a class="eyebrow-state" href="/about/lifecycle" title="Lifecycle: {thesis.lifecycle?.state ?? 'seedling'} — open explanation">
					<LifecycleIcon state={thesis.lifecycle?.state ?? 'seedling'} />
					{thesis.lifecycle?.state ?? 'seedling'}
				</a>
				<span class="eyebrow-sep">·</span>
				<a class="eyebrow-heat" href="/about/heat" title="Heat: {heat} (recent activity {heatRatio.toFixed(2)}× baseline) — open explanation">
					{m.thesis_heat_label({ heat })}
				</a>
			</div>
			{#if editingThesis}
				<form class="edit-form" onsubmit={(e) => { e.preventDefault(); submitEditThesis(); }}>
					<div class="form-group">
						<label for="edit-title">{m.thesis_edit_title_label()}</label>
						<input id="edit-title" type="text" bind:value={editTitle} maxlength="200" required />
					</div>
					<div class="form-group">
						<label for="edit-desc">{m.thesis_edit_desc_label()}</label>
						<textarea id="edit-desc" bind:value={editDescription} maxlength="2000" required></textarea>
					</div>
					<div class="form-group">
						<label for="edit-categories">{m.thesis_edit_categories_label()}</label>
						<div class="category-grid" id="edit-categories">
							{#each categoriesStore.list as cat}
								<button
									type="button"
									class="tag category-btn"
									class:selected={editCategories.includes(cat)}
									onclick={() => toggleEditCategory(cat)}
								>{cat}</button>
							{/each}
						</div>
					</div>
					<div class="form-actions">
						<button class="btn btn-primary" type="submit" disabled={editSubmitting}>
							{editSubmitting ? m.thesis_edit_saving() : m.thesis_edit_save()}
						</button>
						<button class="btn" type="button" onclick={() => (editingThesis = false)}>{m.thesis_edit_cancel()}</button>
					</div>
				</form>
			{:else}
				<div class="thesis-title-row">
					<h1 class="thesis-title">{displayTitle}</h1>
					{#if translateNeeded}
						<button
							type="button"
							class="translate-btn"
							class:active={translated}
							onclick={toggleTranslate}
							disabled={translating}
							title={translated ? m.translate_show_original() : m.translate_to({ locale: (localeStore.current ?? '').toUpperCase() })}
						>
							<svg class="translate-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<circle cx="12" cy="12" r="10"></circle>
								<path d="M2 12h20"></path>
								<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
							</svg>
							{#if translating}
								{m.translate_pending()}
							{:else if translated}
								{m.translate_show_original()}
							{:else}
								{m.translate_to({ locale: (localeStore.current ?? '').toUpperCase() })}
							{/if}
						</button>
					{/if}
				</div>
				<p class="thesis-description">{displayDescription}</p>

				{#if activeVariant}
					<p class="register-indicator" title={m.register_indicator_hint()}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
						{activeVariant === 'simple' ? m.register_reading_simple() : m.register_reading_dense()}
					</p>
				{/if}

				<div class="thesis-meta-row">
					{#each thesis.categories as category}
						<span class="tag">{category}</span>
					{/each}
				</div>

				{#if thesis.hashtags && thesis.hashtags.length > 0}
					<div class="thesis-hashtags">
						{#each thesis.hashtags as tag}
							<span class="hashtag-tag">#{tag}</span>
						{/each}
					</div>
				{/if}

				<div class="thesis-tile-footer">
					{#if voteSummary}
						<VoteRow
							summary={voteSummary}
							currentVote={currentVote}
							currentWeight={currentWeight}
							voting={voting}
							simple={register === 'simple'}
							oncast={castThesisVote}
						/>
					{/if}
					<span class="badge badge-arguments" title="Arguments">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
						</svg>
						{abbreviateNumber(args.length)}
					</span>
					{#if isAuthor}
						<div class="thesis-admin-row">
							<button class="btn btn-sm" onclick={openEditThesis}>{m.thesis_admin_edit()}</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
		</SwipeVote>

		<section class="arguments-section">
			{#if showArgForm}
				<ArgumentForm
					thesisId={thesis.id}
					intent={argIntent}
					{linkedSourceIds}
					onsubmitted={onArgSubmitted}
					oncancel={() => { showArgForm = false; }}
					onneedthesisvote={nudgeThesisVote}
					onlinked={onThesisLinked}
				/>
			{/if}

			<ArgumentColumns
				{topGroups}
				{poolGroups}
				{totalArguments}
				{linkedTheses}
				{pendingReorderCount}
				complexityCapped={argGroups.length > topGroups.length + poolGroups.length}
				{opinionView}
				{hasThesisVote}
				onreorder={recomputeOrder}
				onopenarg={openNewArg}
				onfork={openFork}
				onedit={openEdit}
				onunlink={unlinkThesis}
				onneedthesisvote={nudgeThesisVote}
				onopinionchange={(v) => { opinionView = v; }}
			/>
		</section>

		{#if visibleRelated.length > 0}
			<aside class="related-panel">
				<div class="related-head">
					<span class="related-title">{m.related_title()}</span>
					<span class="related-mode" title={relatedMode === 'semantic' ? m.related_mode_semantic_title() : m.related_mode_thematic_title()}>
						{relatedMode === 'semantic' ? m.related_mode_semantic() : m.related_mode_thematic()}
					</span>
				</div>
				<ul class="related-list">
					{#each visibleRelated as item (item.thesis.id)}
						<li>
							<a class="related-link" href="/thesis/{item.thesis.id}">
								<span class="related-thesis-title">{item.thesis.title}</span>
								<span class="related-cats">
									{#each item.thesis.categories.slice(0, 3) as cat}
										<span class="related-cat">{cat}</span>
									{/each}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			</aside>
		{/if}

		{#if activity.length > 0}
			<section class="thesis-activity card">
				<ActivityGraph
					data={activity}
					title={m.thesis_activity_title({ title: `${thesis.title.slice(0, 30)}${thesis.title.length > 30 ? '…' : ''}` })}
					height={70}
				/>
			</section>
		{/if}

		{#if isAuthor}
			<section class="danger-zone">
				<header class="danger-zone-head">
					<h3 class="danger-zone-title">{m.danger_zone_title()}</h3>
					<p class="danger-zone-hint">{m.danger_zone_hint()}</p>
				</header>
				<div class="danger-zone-row">
					<div class="danger-zone-item-info">
						<strong>{thesis.archived ? m.danger_zone_unarchive_title() : m.danger_zone_archive_title()}</strong>
						<span>{thesis.archived ? m.danger_zone_unarchive_desc() : m.danger_zone_archive_desc()}</span>
					</div>
					<button class="btn btn-danger" onclick={toggleArchive}>
						{thesis.archived ? m.thesis_admin_unarchive() : m.thesis_admin_archive()}
					</button>
				</div>
			</section>
		{/if}
	</article>

	<Popup open={needThesisVoteHint} variant="modal" cardClass="vote-nudge-card" onclose={() => (needThesisVoteHint = false)}>
		<span class="vote-nudge-icon" aria-hidden="true">
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"></path><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
		</span>
		<p class="vote-nudge-text">{m.thesis_vote_first_hint()}</p>
	</Popup>
{:else}
	<div class="not-found">
		<h1>{m.not_found_thesis_title()}</h1>
		<a href="/" class="btn btn-primary">{m.not_found_back_home()}</a>
	</div>
{/if}

<style>
	.thesis-detail {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.thesis-detail.archived {
		opacity: 0.7;
	}

	.archived-banner {
		padding: 0.5rem 0.75rem;
		background: #fef3c7;
		color: #92400e;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.back-link {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		display: inline-block;
	}

	.back-link:hover {
		color: var(--color-primary);
	}

	.thesis-tile {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		background: white;
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		position: relative;
		overflow: hidden;
	}

	/* Heat as a soft, colourful glow — reads the shared --color-heat-* theme
	   variables so the detail tile matches the feed card and the /about legend
	   exactly. Hotter = larger glow + shift toward the hot colour. Even cold
	   shows a faint glow. Hidden in calm mode (app.css). */
	.thesis-tile.heat-cold { --heat-glow: 0 0 10px -3px color-mix(in srgb, var(--color-heat-cold) 50%, transparent); }
	.thesis-tile.heat-cool { --heat-glow: 0 0 14px -3px color-mix(in srgb, var(--color-heat-cool) 60%, transparent); }
	.thesis-tile.heat-warm { --heat-glow: 0 0 26px -2px color-mix(in srgb, var(--color-heat-warm) 85%, transparent); }
	.thesis-tile.heat-hot  { --heat-glow: 0 0 30px -2px color-mix(in srgb, var(--color-heat-hot) 90%, transparent); }
	.thesis-tile[class*='heat-'] { box-shadow: var(--heat-glow); }

	/* Editorial eyebrow: lifecycle (icon + word) · heat, both linking to their
	   explainer pages. Mirrors the feed card's eyebrow. */
	.thesis-eyebrow {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-light);
	}
	.thesis-eyebrow .eyebrow-state,
	.thesis-eyebrow .eyebrow-heat {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: inherit;
		text-decoration: none;
	}
	.thesis-eyebrow .eyebrow-state:hover,
	.thesis-eyebrow .eyebrow-heat:hover {
		color: var(--color-primary);
	}
	.thesis-eyebrow .eyebrow-sep {
		opacity: 0.5;
	}

	.badge-arguments {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		font-size: var(--text-xs);
		font-weight: 500;
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.thesis-activity {
		padding: 0.75rem 1rem;
	}

	.danger-zone {
		border: 1px solid var(--color-reject);
		border-radius: var(--radius-lg);
		padding: 1rem 1.25rem;
		background: var(--color-reject-bg);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.danger-zone-head {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.danger-zone-title {
		font-size: var(--text-base);
		font-weight: 700;
		color: var(--color-reject);
		margin: 0;
	}

	.danger-zone-hint {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin: 0;
	}

	.danger-zone-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem;
		border-radius: var(--radius-md);
		background: white;
		border: 1px solid var(--color-reject);
	}

	.danger-zone-item-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: var(--text-sm);
	}
	.danger-zone-item-info strong {
		color: var(--color-text);
	}
	.danger-zone-item-info span {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}

	.btn-danger {
		background: var(--color-reject);
		color: white;
		border: 1px solid var(--color-reject);
	}
	.btn-danger:hover {
		filter: brightness(0.92);
	}

	.thesis-title {
		font-size: var(--text-3xl);
		font-weight: 700;
		line-height: 1.2;
		margin: 0;
	}

	.thesis-description {
		font-size: var(--text-base);
		color: var(--color-text-muted);
		line-height: 1.6;
		margin: 0;
	}

	.thesis-meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.thesis-hashtags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.35rem;
	}

	.hashtag-tag {
		display: inline-flex;
		align-items: center;
		font-size: 0.75rem;
		background: #ecfeff;
		color: #0e7490;
		border: 1px solid #a5f3fc;
		border-radius: 9999px;
		padding: 0.1rem 0.55rem;
	}

	.thesis-title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.translate-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.6rem;
		font-size: var(--text-xs);
		font-weight: 600;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
		transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast);
	}

	.translate-btn:hover:not(:disabled) {
		color: var(--color-primary);
		background: var(--color-primary-bg);
		border-color: var(--color-primary);
	}

	.translate-btn.active {
		color: var(--color-primary);
		background: var(--color-primary-bg);
		border-color: var(--color-primary);
	}

	.translate-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.translate-icon {
		flex-shrink: 0;
	}

	.register-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		align-self: flex-start;
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		background: var(--color-primary-bg);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		padding: 0.15rem 0.6rem;
		margin: 0;
	}

	.thesis-tile-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
		flex-wrap: wrap;
	}

	/* Centred, auto-dismissing "vote on the thesis first" nudge. Matches the
	   header modal-card shape (surface card, soft border, big shadow, dimmed
	   backdrop). Accent-tinted so it reads as a prompt, not an error — but in
	   calm mode it drops to the neutral surface to stay quiet. */
	/* Vote-first nudge: uses the shared <Popup variant="modal"> shell for the
	   backdrop + centring; here we only restyle the card as an accent-tinted
	   prompt (calm mode drops to neutral surface). The 1.8s fade matches the
	   JS auto-dismiss timer. Card lives inside Popup, so target it globally. */
	:global(.vote-nudge-card) {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: auto !important;
		max-width: min(92vw, 22rem);
		background: var(--color-primary) !important;
		color: var(--color-on-primary);
		border: none !important;
		animation: vote-nudge-fade 1.8s ease forwards;
	}
	.vote-nudge-icon {
		display: inline-flex;
		flex-shrink: 0;
	}
	.vote-nudge-text {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		line-height: 1.35;
	}
	:global([data-calm='true'] .vote-nudge-card) {
		background: var(--color-surface) !important;
		color: var(--color-text);
		border: 1px solid var(--color-border) !important;
	}
	@keyframes vote-nudge-fade {
		0% { opacity: 0; }
		12% { opacity: 1; }
		80% { opacity: 1; }
		100% { opacity: 0; }
	}

	.thesis-admin-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.arguments-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.form-actions {
		display: flex;
		gap: 0.5rem;
	}

	.category-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.category-btn {
		cursor: pointer;
		border: 1px solid var(--color-border);
	}

	.category-btn.selected {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.not-found {
		text-align: center;
		padding: 4rem 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.related-panel {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.related-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.related-title {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.related-mode {
		font-size: 0.65rem;
		font-family: var(--font-mono);
		color: var(--color-text-light);
		text-transform: lowercase;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		padding: 0.1rem 0.5rem;
	}

	.related-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.related-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--color-text);
		transition: background var(--transition-fast);
	}

	.related-link:hover {
		background: var(--color-bg);
	}

	.related-thesis-title {
		font-size: var(--text-sm);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.related-cats {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.related-cat {
		font-size: 0.65rem;
		font-family: var(--font-mono);
		color: var(--color-text-light);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		padding: 0.1rem 0.45rem;
		text-transform: capitalize;
	}
</style>
