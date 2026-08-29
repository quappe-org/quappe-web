<script lang="ts">
	import type { Thesis, VoteSummary, VoteType } from '$lib/models/types';
	import { getUserId } from '$lib/stores/user';
	import { getLocale } from '$lib/paraglide/runtime';
	import { localeStore } from '$lib/stores/locale.svelte';
	import { m } from '$lib/paraglide/messages';
	import VoteRow from '$lib/components/VoteRow.svelte';
	import SwipeVote from '$lib/components/SwipeVote.svelte';
	import LifecycleIcon from '$lib/components/LifecycleIcon.svelte';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { registerForComplexity, pickDescription } from '$lib/models/variants';

	let {
		thesis,
		heatRatio = 0,
		argumentCount = 0,
		showVoteButtons = true,
		onvoted
	}: {
		thesis: Thesis;
		heatRatio?: number;
		argumentCount?: number;
		showVoteButtons?: boolean;
		/** Fires after the server confirms a vote (or immediately after the
		 *  optimistic update if the server call has yet to return). The feed
		 *  uses this to start the fade-out timer. */
		onvoted?: () => void;
	} = $props();

	let voteSummary = $derived.by<VoteSummary>(() => {
		let support = 0, reject = 0, neutral = 0, voters = 0;
		for (const v of thesis.votes) {
			const w = v.weight || 1;
			voters++;
			if (v.type === 'support') support += w;
			else if (v.type === 'reject') reject += w;
			else neutral += w;
		}
		return { support, reject, neutral, total: support + reject + neutral, voters };
	});

	let heat = $derived.by(() => {
		if (heatRatio >= 1.5) return 'hot';
		if (heatRatio >= 0.75) return 'warm';
		if (heatRatio > 0) return 'cool';
		return 'cold';
	});

	let voting = $state(false);
	let currentVote = $state<VoteType | null>(null);
	let currentWeight = $state(1);
	let hasVotedLocally = $state(false);

	let serverVote = $derived.by<{ type: VoteType; weight: number } | null>(() => {
		if (typeof window === 'undefined') return null;
		const userId = getUserId();
		const existing = thesis.votes.find((v) => v.user_id === userId);
		return existing ? { type: existing.type, weight: existing.weight || 1 } : null;
	});

	$effect(() => {
		if (!hasVotedLocally) {
			currentVote = serverVote?.type ?? null;
			currentWeight = serverVote?.weight ?? 1;
		}
	});

	let translated = $state<{ title: string; description: string } | null>(null);
	let translating = $state(false);
	let displayLocale = $state<string | null>(null);

	let needsTranslate = $derived.by(() => {
		if (!thesis.lang) return false;
		if (!localeStore.current) return false;
		return thesis.lang !== localeStore.current;
	});

	// Author-provided register bound to the complexity slider (fallback: original).
	// Only the description has registers — the title is always canonical.
	let register = $derived(registerForComplexity(complexityStore.settings.max_arguments));
	let baseDescription = $derived(pickDescription(thesis, register));

	let displayTitle = $derived(translated?.title ?? thesis.title);
	let displayDescription = $derived(translated?.description ?? baseDescription);

	async function toggleTranslate(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (translated) {
			translated = null;
			displayLocale = null;
			return;
		}
		if (translating) return;
		translating = true;
		try {
			const target = localeStore.current ?? getLocale();
			const res = await fetch(`/api/theses/${thesis.id}/translate?to=${target}`);
			if (!res.ok) return;
			const data = (await res.json()) as { title: string; description: string; target: string };
			translated = { title: data.title, description: data.description };
			displayLocale = data.target;
		} finally {
			translating = false;
		}
	}

	async function castVote(type: VoteType, weight: number) {
		if (voting) return;
		// Base weight-1 votes are free; only extra weight draws from the pool.
		const isRetract = currentVote === type && currentWeight === weight;
		const chargeable = !isRetract && (type === 'support' || type === 'reject') && weight > 1;
		if (chargeable) {
			if (!budgetStore.canAffordWeight(weight)) return;
			budgetStore.spendWeight(weight);
		}
		voting = true;
		try {
			const userId = getUserId();
			const res = await fetch(`/api/theses/${thesis.id}/vote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type, weight })
			});
			if (!res.ok) {
				if (chargeable) budgetStore.refundWeight(weight);
				return;
			}
			const data = await res.json();
			const summary = data.vote_summary as VoteSummary;
			// If same type and same weight, server retracted the vote.
			const newVote: VoteType | null = currentVote === type && currentWeight === weight ? null : type;
			const newWeight: number = newVote ? weight : 1;
			currentVote = newVote;
			currentWeight = newWeight;
			hasVotedLocally = true;
			// Rebuild synthetic votes list so summary reactivity works for this card.
			const totalWeightSupport = summary.support;
			const totalWeightReject = summary.reject;
			const totalWeightNeutral = summary.neutral;
			const votes = [
				...Array(totalWeightSupport).fill({ user_id: '', type: 'support', weight: 1, cast_at: '' }),
				...Array(totalWeightReject).fill({ user_id: '', type: 'reject', weight: 1, cast_at: '' }),
				...Array(totalWeightNeutral).fill({ user_id: '', type: 'neutral', weight: 1, cast_at: '' })
			];
			if (newVote) {
				// Replace one placeholder with the real user's vote to preserve current-vote detection.
				const idx = votes.findIndex((v) => v.type === newVote);
				if (idx >= 0) {
					votes[idx] = {
						user_id: userId,
						type: newVote,
						weight: newWeight,
						cast_at: new Date().toISOString()
					};
				}
			}
			thesis.votes = votes;
			// Let the feed (or wherever we're embedded) know the user just
			// voted, so it can start the fade-out. Only fire on a cast that
			// results in an active vote (not on retraction).
			if (newVote) onvoted?.();
		} finally {
			voting = false;
		}
	}
</script>

<SwipeVote oncast={showVoteButtons ? castVote : undefined}>
	<a
		href="/thesis/{thesis.id}"
		class="card thesis-card heat-{heat}"
	>
	<div class="thesis-eyebrow">
		{#if thesis.categories.length > 0}
			<span class="eyebrow-cat">{thesis.categories[0]}</span>
			<span class="eyebrow-sep">·</span>
		{/if}
		<span class="eyebrow-state">
			<LifecycleIcon state={thesis.lifecycle?.state ?? 'seedling'} />
			{thesis.lifecycle?.state ?? 'seedling'}
		</span>
		{#if argumentCount > 0}
			<span class="eyebrow-sep">·</span>
			<span class="eyebrow-args">{argumentCount} {argumentCount === 1 ? m.card_argument_one() : m.card_argument_many()}</span>
		{/if}
	</div>
	<div class="thesis-title-row">
		<h3 class="thesis-title">{displayTitle}</h3>
		{#if needsTranslate}
			<button
				type="button"
				class="translate-icon-btn"
				class:active={translated}
				onclick={toggleTranslate}
				disabled={translating}
				aria-label={translated ? m.translate_show_original() : m.translate_to({ locale: (localeStore.current ?? '').toUpperCase() })}
				title={translated ? m.translate_show_original() : m.translate_to({ locale: (localeStore.current ?? '').toUpperCase() })}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<circle cx="12" cy="12" r="10"></circle>
					<path d="M2 12h20"></path>
					<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
				</svg>
			</button>
		{/if}
	</div>
	<p class="thesis-description">{displayDescription}</p>

	<div class="thesis-categories">
		{#each thesis.categories as category}
			<span class="tag">{category}</span>
		{/each}
	</div>

	{#if thesis.hashtags && thesis.hashtags.length > 0}
		<!-- Hashtags are filter metadata, not feed-decision info — shown on the
		     detail page only, to keep the feed card calm (progressive disclosure). -->
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div class="thesis-footer" onclick={(e) => e.preventDefault()} onkeydown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
		{#if voteSummary.total > 0}
			<div class="vote-bar-wrap" title="+{voteSummary.support} support · −{voteSummary.reject} reject · ~{voteSummary.neutral} neutral">
				<div class="vote-bar">
					{#if voteSummary.support > 0}
						<span class="vb-seg vb-seg-support" style="flex: {voteSummary.support}"></span>
					{/if}
					{#if voteSummary.neutral > 0}
						<span class="vb-seg vb-seg-neutral" style="flex: {voteSummary.neutral}"></span>
					{/if}
					{#if voteSummary.reject > 0}
						<span class="vb-seg vb-seg-reject" style="flex: {voteSummary.reject}"></span>
					{/if}
				</div>
			</div>
		{/if}
		<div class="thesis-footer-row">
			<VoteRow
				summary={voteSummary}
				currentVote={currentVote}
				currentWeight={currentWeight}
				voting={voting}
				compact
				simple={register === 'simple'}
				showButtons={showVoteButtons}
				oncast={castVote}
			/>
		</div>
	</div>
	</a>
</SwipeVote>

<style>
	.thesis-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		position: relative;
		padding: 1.5rem;
		transition: box-shadow var(--transition-base), transform var(--transition-fast);
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		justify-content: space-between;
		overflow: hidden;
	}

	@media (max-width: 768px) {
		.thesis-card {
			padding: 1rem;
			gap: 0.6rem;
		}
	}

	/* Heat as a soft glow instead of a side band. ONE colour (the theme accent),
	   INTENSITY = heat: more glow == hotter. Uses the palette's own primary so it
	   never clashes with a theme. Even cold shows a faint glow so no card looks
	   unfinished. `--heat-glow` is the single source of truth so base + hover
	   agree; hidden entirely in calm mode (app.css). */
	.thesis-card.heat-cold { --heat-glow: 0 0 8px -3px color-mix(in srgb, var(--color-primary) 25%, transparent); }
	.thesis-card.heat-cool { --heat-glow: 0 0 12px -3px color-mix(in srgb, var(--color-primary) 40%, transparent); }
	.thesis-card.heat-warm { --heat-glow: 0 0 18px -3px color-mix(in srgb, var(--color-primary) 60%, transparent); }
	.thesis-card.heat-hot  { --heat-glow: 0 0 26px -2px color-mix(in srgb, var(--color-primary) 80%, transparent); }
	.thesis-card[class*='heat-'] { box-shadow: var(--heat-glow); }

	.thesis-card:hover {
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}

	/* Keep the heat glow on hover, layered under the lift shadow. */
	.thesis-card[class*='heat-']:hover { box-shadow: var(--shadow-md), var(--heat-glow); }

	.thesis-card:hover .thesis-title {
		color: var(--color-primary);
	}

	/* Editorial eyebrow: small uppercase meta line above the headline */
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

	.eyebrow-cat {
		color: var(--color-primary);
	}

	.eyebrow-state {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.eyebrow-sep {
		opacity: 0.5;
	}

	.thesis-title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.thesis-title {
		font-family: var(--font-serif);
		font-size: clamp(1.05rem, 2.8vw, 1.35rem);
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.01em;
		color: var(--color-text);
		transition: color var(--transition-fast);
	}

	.thesis-description {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		line-height: 1.6;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.thesis-categories {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.translate-icon-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-top: 0.05rem;
		border-radius: 50%;
		background: transparent;
		color: var(--color-text-light);
		border: none;
		cursor: pointer;
		transition: color var(--transition-fast), background var(--transition-fast);
	}

	.translate-icon-btn:hover:not(:disabled) {
		color: var(--color-primary);
		background: var(--color-primary-bg);
	}

	.translate-icon-btn.active {
		color: var(--color-primary);
		background: var(--color-primary-bg);
	}

	.translate-icon-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.thesis-footer {
		margin-top: 0.25rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.thesis-footer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.vote-bar-wrap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.vote-bar {
		flex: 1;
		display: flex;
		height: 7px;
		border-radius: 4px;
		overflow: hidden;
		gap: 1px;
		background: var(--color-border);
	}

	.vb-seg {
		display: block;
		height: 100%;
		min-width: 2px;
		border-radius: 2px;
	}

	.vb-seg-support { background: var(--color-support); }
	.vb-seg-neutral { background: var(--color-neutral); }
	.vb-seg-reject  { background: var(--color-reject); }
</style>
