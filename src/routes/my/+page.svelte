<script lang="ts">
	import type { Thesis, VoteType } from '$lib/models/types';
	import { getUserId } from '$lib/stores/user';
	import { userIdTick } from '$lib/stores/user-tick.svelte';
	import { activityStore } from '$lib/stores/activity.svelte';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import ThesisCard from '$lib/components/ThesisCard.svelte';
	import SwipeVote from '$lib/components/SwipeVote.svelte';
	import ScrollSentinel from '$lib/components/ScrollSentinel.svelte';
	import { nextFibWeight, FIB_WEIGHTS } from '$lib/models/fibonacci';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

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
		activityStore.set(data.activity ?? [], m.my_platform_activity());
	});

	// A thesis paired with the timestamp that places it on my timeline:
	// authored → creation time; voted → the thesis's last-update time (server-set,
	// bumped on every vote incl. weight changes).
	interface TimelineEntry {
		thesis: Thesis;
		at: string; // ISO — used only for the time-band grouping, not for ordering
	}

	// Ordering is FROZEN at load time (see the $effect below), so re-weighting a
	// vote — which rewrites thesis.votes client-side — never re-sorts the list and
	// makes tiles jump. The frozen rank is computed server-side by updated_at;
	// the live list only reloads on navigation.
	let frozenVotedRank = $state<Map<string, number>>(new Map());
	let frozenAuthoredRank = $state<Map<string, number>>(new Map());

	let authoredEntries = $derived.by<TimelineEntry[]>(() => {
		if (typeof window === 'undefined') return [];
		userIdTick(); // re-run when bootstrapUserId() replaces the cached id
		const userId = getUserId();
		if (!userId) return [];
		return allTheses
			.filter((t) => t.meta.author_id === userId)
			.filter((t) => frozenAuthoredRank.has(t.id))
			.map((t) => ({ thesis: t, at: t.meta.created_at }))
			.sort((a, b) => (frozenAuthoredRank.get(a.thesis.id) ?? 0) - (frozenAuthoredRank.get(b.thesis.id) ?? 0));
	});

	let votedEntries = $derived.by<TimelineEntry[]>(() => {
		if (typeof window === 'undefined') return [];
		userIdTick();
		const userId = getUserId();
		if (!userId) return [];
		const out: TimelineEntry[] = [];
		for (const t of allTheses) {
			if (t.meta.author_id === userId) continue;
			// Frozen rank keeps the card visible AND positioned even after a
			// weight-change rewrites thesis.votes.
			if (!frozenVotedRank.has(t.id)) continue;
			const mine = t.votes.find((v) => v.user_id === userId);
			out.push({ thesis: t, at: mine?.cast_at || t.meta.updated_at || t.meta.created_at });
		}
		return out.sort((a, b) => (frozenVotedRank.get(a.thesis.id) ?? 0) - (frozenVotedRank.get(b.thesis.id) ?? 0));
	});

	// ---- Load-more paging (skips empty periods naturally) ----
	const PAGE = 20;
	let authoredShown = $state(PAGE);
	let votedShown = $state(PAGE);

	// Freeze BOTH lists' order at load time. Re-weighting a vote rewrites
	// thesis.votes locally; without a frozen rank the derived lists would re-sort
	// and tiles would jump. We recompute the rank only when the SERVER data
	// changes (navigation/reload) — reading data.theses, not the locally-mutated
	// allTheses — sorting newest-first by the server's updated_at (bumped on every
	// vote, incl. weight changes) with created_at as a tiebreak/fallback.
	$effect(() => {
		const userId = getUserId();
		const source = data.theses ?? [];
		const tsOf = (t: Thesis) => Date.parse(t.meta.updated_at) || Date.parse(t.meta.created_at) || 0;

		const voted = source
			.filter((t) => t.meta.author_id !== userId && t.votes.some((v) => v.user_id === userId))
			.sort((a, b) => tsOf(b) - tsOf(a));
		const votedRank = new Map<string, number>();
		voted.forEach((t, i) => votedRank.set(t.id, i));
		frozenVotedRank = votedRank;

		const authored = source
			.filter((t) => t.meta.author_id === userId)
			.sort((a, b) => (Date.parse(b.meta.created_at) || 0) - (Date.parse(a.meta.created_at) || 0));
		const authoredRank = new Map<string, number>();
		authored.forEach((t, i) => authoredRank.set(t.id, i));
		frozenAuthoredRank = authoredRank;
	});

	// Per-thesis weight overrides for this session: swipe → step up Fibonacci.
	let weightOverrides = $state<Map<string, number>>(new Map());

	// Transient feedback when a weight-up swipe is rejected server-side
	// (daily weight budget reached, or a brand-new identity in its first
	// minute). Without this the swipe silently does nothing.
	let swipeNotice = $state<string | null>(null);
	let swipeNoticeTimer: ReturnType<typeof setTimeout> | null = null;
	function showSwipeNotice(msg: string) {
		swipeNotice = msg;
		if (swipeNoticeTimer) clearTimeout(swipeNoticeTimer);
		swipeNoticeTimer = setTimeout(() => (swipeNotice = null), 4000);
	}

	function getCurrentWeight(thesis: Thesis): number {
		if (weightOverrides.has(thesis.id)) return weightOverrides.get(thesis.id)!;
		const userId = getUserId();
		const mine = thesis.votes.find((v) => v.user_id === userId);
		return mine?.weight ?? 1;
	}

	function getCurrentVoteType(thesis: Thesis): VoteType | null {
		const userId = getUserId();
		const mine = thesis.votes.find((v) => v.user_id === userId);
		return mine ? (mine.type as VoteType) : null;
	}

	async function handleWeightSwipe(thesis: Thesis, direction: 'right' | 'left') {
		const userId = getUserId();
		const mine = thesis.votes.find((v) => v.user_id === userId);
		if (!mine) return; // no prior vote — nothing to weight up
		const currentType = mine.type as VoteType;
		const swipedType: VoteType = direction === 'right' ? 'support' : 'reject';
		// Swipe must match the existing vote direction; ignore cross-direction swipes.
		if (swipedType !== currentType) return;
		const currentW = getCurrentWeight(thesis);
		const nextW = nextFibWeight(currentW, FIB_WEIGHTS as number[]);
		if (nextW <= currentW) return; // already at max — don't wrap back down
		if (nextW > 1 && !budgetStore.canAffordWeight(nextW)) return;
		if (nextW > 1) budgetStore.spendWeight(nextW);
		try {
			const res = await fetch(`/api/theses/${thesis.id}/vote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: currentType, weight: nextW })
			});
			if (!res.ok) {
				if (nextW > 1) budgetStore.refundWeight(nextW);
				let reason = '';
				try {
					reason = ((await res.json()) as { error?: string }).error ?? '';
				} catch {
					reason = '';
				}
				showSwipeNotice(
					/new identit/i.test(reason) ? m.my_weight_denied_new() : m.my_weight_denied_budget()
				);
				return;
			}
			weightOverrides = new Map(weightOverrides).set(thesis.id, nextW);
		} catch {
			if (nextW > 1) budgetStore.refundWeight(nextW);
		}
	}

	let authoredPage = $derived(authoredEntries.slice(0, authoredShown));
	let votedPage = $derived(votedEntries.slice(0, votedShown));

	// ---- Time grouping with dividers ----
	// Buckets entries into Today / This week / "Month YYYY" bands. Empty bands
	// never appear (we only render groups that have entries).
	interface TimeGroup {
		key: string;
		label: string;
		entries: TimelineEntry[];
	}

	function startOfDay(d: Date): number {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	}

	function groupByTime(entries: TimelineEntry[]): TimeGroup[] {
		const now = new Date();
		const todayStart = startOfDay(now);
		const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000; // last 7 days incl. today
		const groups: TimeGroup[] = [];
		const byKey = new Map<string, TimeGroup>();

		for (const e of entries) {
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
				g = { key, label, entries: [] };
				byKey.set(key, g);
				groups.push(g);
			}
			g.entries.push(e);
		}
		return groups;
	}

	let authoredGroups = $derived(groupByTime(authoredPage));
	let votedGroups = $derived(groupByTime(votedPage));

	// ---- Standpoint report ----
	interface ReportBody {
		text: string | null;
		stats?: {
			theses_authored: number;
			arguments_authored: number;
			votes_cast: { support: number; reject: number; neutral: number };
			dominant_categories: { name: string; count: number }[];
			engaged_theses: number;
		};
		references?: { thesis_id: string; snippet: string }[];
		cached?: boolean;
		llm?: { ok: boolean; model?: string | null; error?: string; hint?: string; duration_ms?: number };
	}
	let report = $state<ReportBody | null>(null);
	let reportLoading = $state(false);
	let reportError = $state<string | null>(null);

	async function loadReport(force = false) {
		if (typeof window === 'undefined') return;
		reportLoading = true;
		reportError = null;
		try {
			const qs = new URLSearchParams();
			if (force) qs.set('force', 'true');
			const suffix = qs.toString() ? `?${qs.toString()}` : '';
			const res = await fetch(`/api/reports/me${suffix}`);
			if (!res.ok) {
				reportError = m.my_standpoint_server_error({ status: res.status });
				return;
			}
			report = await res.json();
		} catch (err) {
			reportError = (err as Error)?.message ?? m.my_standpoint_unknown_error();
		} finally {
			reportLoading = false;
		}
	}
</script>

<section class="my-page">
	<div class="page-head">
		<h1 class="page-title">{m.my_page_title()}</h1>
		<p class="page-subtitle">{m.my_page_subtitle()}</p>
	</div>

	<aside class="standpoint-panel card">
		<div class="standpoint-head">
			<h2 class="standpoint-title">{m.my_standpoint_title()}</h2>
			<p class="standpoint-sub">{m.my_standpoint_sub()}</p>
		</div>

		{#if !report && !reportLoading}
			<button class="btn btn-primary" onclick={() => loadReport(false)}>{m.my_standpoint_generate()}</button>
		{/if}

		{#if reportLoading}
			<p class="standpoint-status">{m.my_standpoint_generating()}</p>
		{/if}

		{#if report}
			{#if report.llm && !report.llm.ok}
				<div class="standpoint-error">
					<p>{m.my_standpoint_llm_unavailable({ error: report.llm.error ?? '' })}</p>
					{#if report.llm.hint}<p class="standpoint-hint">{report.llm.hint}</p>{/if}
				</div>
			{:else if report.text}
				<div class="standpoint-text">
					{#each report.text.split(/\n\n+/) as para}
						<p>{para}</p>
					{/each}
				</div>
				{#if report.references && report.references.length > 0}
					<div class="standpoint-refs">
						<span class="refs-label">{m.my_standpoint_refs_label()}</span>
						{#each report.references as ref}
							<a class="ref-link" href="/thesis/{ref.thesis_id}">{ref.snippet}</a>
						{/each}
					</div>
				{/if}
				<div class="standpoint-meta">
					{report.cached ? m.my_standpoint_cached() : m.my_standpoint_fresh()}{#if report.llm?.model} · {report.llm.model}{/if}
					<button class="btn btn-sm standpoint-refresh" onclick={() => loadReport(true)}>{m.my_standpoint_regenerate()}</button>
				</div>
			{:else}
				<p class="standpoint-status">{reportError ?? m.my_standpoint_no_text()}</p>
			{/if}
		{/if}

		{#if reportError && !report}
			<p class="standpoint-error">{reportError}</p>
		{/if}
	</aside>

	{#if authoredEntries.length > 0}
		<h2 class="section-title">{m.my_section_authored()}</h2>
		{#each authoredGroups as group (group.key)}
			<div class="time-divider">{group.label}</div>
			<div class="thesis-stack">
				{#each group.entries as entry (entry.thesis.id)}
					<ThesisCard thesis={entry.thesis} heatRatio={heat[entry.thesis.id] ?? 0} argumentCount={argumentCounts[entry.thesis.id] ?? 0} showVoteButtons={false} />
				{/each}
			</div>
		{/each}
		{#if authoredEntries.length > authoredShown}
			<ScrollSentinel onVisible={() => authoredShown += PAGE} />
			<div class="load-more-wrap">
				<button class="btn btn-sm" onclick={() => authoredShown += PAGE}>{m.my_load_more()}</button>
			</div>
		{/if}
	{/if}

	{#if votedEntries.length > 0}
		<h2 class="section-title">{m.my_section_voted()}</h2>
		{#each votedGroups as group (group.key)}
			<div class="time-divider">{group.label}</div>
			<div class="thesis-stack">
				{#each group.entries as entry (entry.thesis.id)}
					{@const voteType = getCurrentVoteType(entry.thesis)}
					{@const currentW = getCurrentWeight(entry.thesis)}
					{@const nextW = nextFibWeight(currentW, FIB_WEIGHTS as number[])}
					<div class="voted-entry">
						<SwipeVote
							onSwipeRight={voteType === 'support' && nextW > currentW ? () => handleWeightSwipe(entry.thesis, 'right') : undefined}
							onSwipeLeft={voteType === 'reject' && nextW > currentW ? () => handleWeightSwipe(entry.thesis, 'left') : undefined}
							allowNeutral={false}
							positiveLabel={nextW > currentW ? `weight ${currentW} → ${nextW}` : `max weight (${currentW})`}
							negativeLabel={nextW > currentW ? `weight ${currentW} → ${nextW}` : `max weight (${currentW})`}
						>
							<ThesisCard thesis={entry.thesis} heatRatio={heat[entry.thesis.id] ?? 0} argumentCount={argumentCounts[entry.thesis.id] ?? 0} />
						</SwipeVote>
						{#if currentW > 1}
							<span class="weight-badge" title="Your vote weight">{currentW}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/each}
		{#if votedEntries.length > votedShown}
			<ScrollSentinel onVisible={() => votedShown += PAGE} />
			<div class="load-more-wrap">
				<button class="btn btn-sm" onclick={() => votedShown += PAGE}>{m.my_load_more()}</button>
			</div>
		{/if}
	{/if}

	{#if authoredEntries.length === 0 && votedEntries.length === 0}
		<p class="empty-state">{m.my_empty_state()}</p>
	{/if}

	{#if swipeNotice}
		<div class="swipe-notice" role="status" aria-live="polite">{swipeNotice}</div>
	{/if}
</section>

<style>
	.my-page {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.my-page :global(.card) {
		padding: var(--space-lg);
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

	.empty-state {
		text-align: center;
		color: var(--color-text-muted);
		padding: 3rem 1rem;
		font-size: var(--text-lg);
	}

	.section-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-text);
		margin: 0.5rem 0 0;
	}

	.time-divider {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-light);
		padding: 0.5rem 0 0.25rem;
		border-bottom: 1px solid var(--color-border);
		margin-top: 0.5rem;
	}

	.load-more-wrap {
		display: flex;
		justify-content: center;
		padding: 0.75rem 0;
	}

	.thesis-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg, 1.25rem);
	}

	.voted-entry {
		position: relative;
	}

	.weight-badge {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 4;
		background: var(--color-primary);
		color: white;
		font-size: 0.6rem;
		font-weight: 700;
		font-family: var(--font-mono);
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		pointer-events: none;
	}

	.standpoint-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.standpoint-head {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.standpoint-title {
		font-size: var(--text-lg);
		font-weight: 600;
		margin: 0;
	}

	.standpoint-sub {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.standpoint-status {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
	}

	.standpoint-text {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.standpoint-text p {
		margin: 0;
		font-size: var(--text-base);
		line-height: 1.55;
	}

	.standpoint-refs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--color-border);
		font-size: var(--text-xs);
	}

	.refs-label {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.ref-link {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		padding: 0.15rem 0.55rem;
		color: var(--color-text);
		text-decoration: none;
		max-width: 26ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ref-link:hover {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.standpoint-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-xs);
		color: var(--color-text-light);
		font-family: var(--font-mono);
	}

	.standpoint-refresh {
		margin-left: auto;
	}

	.standpoint-error {
		background: var(--color-reject-bg);
		border: 1px solid var(--color-reject);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
		color: var(--color-reject);
		font-size: var(--text-sm);
	}

	.swipe-notice {
		position: fixed;
		left: 50%;
		bottom: 1.5rem;
		transform: translateX(-50%);
		z-index: 50;
		max-width: min(92vw, 34rem);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		padding: 0.6rem 0.9rem;
		color: var(--color-text);
		font-size: var(--text-sm);
		text-align: center;
	}

	.standpoint-hint {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin: 0.25rem 0 0;
	}
</style>
