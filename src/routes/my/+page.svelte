<script lang="ts">
	import type { Thesis } from '$lib/models/types';
	import { getUserId } from '$lib/stores/user';
	import { userIdTick } from '$lib/stores/user-tick.svelte';
	import { activityStore } from '$lib/stores/activity.svelte';
	import ThesisCard from '$lib/components/ThesisCard.svelte';
	import ScrollSentinel from '$lib/components/ScrollSentinel.svelte';
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
	// authored → creation time; voted → the time I cast my vote.
	interface TimelineEntry {
		thesis: Thesis;
		at: string; // ISO
	}

	let authoredEntries = $derived.by<TimelineEntry[]>(() => {
		if (typeof window === 'undefined') return [];
		userIdTick(); // re-run when bootstrapUserId() replaces the cached id
		const userId = getUserId();
		if (!userId) return [];
		return allTheses
			.filter((t) => t.meta.author_id === userId)
			.map((t) => ({ thesis: t, at: t.meta.created_at }))
			.sort((a, b) => (a.at < b.at ? 1 : -1));
	});

	let votedEntries = $derived.by<TimelineEntry[]>(() => {
		if (typeof window === 'undefined') return [];
		userIdTick(); // re-run when bootstrapUserId() replaces the cached id
		const userId = getUserId();
		if (!userId) return [];
		const out: TimelineEntry[] = [];
		for (const t of allTheses) {
			if (t.meta.author_id === userId) continue;
			const mine = t.votes.find((v) => v.user_id === userId);
			if (mine) out.push({ thesis: t, at: mine.cast_at || t.meta.created_at });
		}
		return out.sort((a, b) => (a.at < b.at ? 1 : -1));
	});

	// ---- Load-more paging (skips empty periods naturally) ----
	const PAGE = 20;
	let authoredShown = $state(PAGE);
	let votedShown = $state(PAGE);

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
			<div class="grid grid-2">
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
			<div class="grid grid-2">
				{#each group.entries as entry (entry.thesis.id)}
					<ThesisCard thesis={entry.thesis} heatRatio={heat[entry.thesis.id] ?? 0} argumentCount={argumentCounts[entry.thesis.id] ?? 0} />
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

	.standpoint-hint {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin: 0.25rem 0 0;
	}
</style>
