<script lang="ts">
	import type { Argument, ThesisEdgeHydrated, VoteSummary, VoteType } from '$lib/models/types';
	import ArgumentCard from '$lib/components/ArgumentCard.svelte';
	import LifecycleIcon from '$lib/components/LifecycleIcon.svelte';
	import VoteRow from '$lib/components/VoteRow.svelte';
	import SwipeVote from '$lib/components/SwipeVote.svelte';
	import { getUserId, markVotedArg } from '$lib/stores/user';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { noticeStore } from '$lib/stores/notice.svelte';
	import { nextFibWeight } from '$lib/models/fibonacci';
	import { m } from '$lib/paraglide/messages';

	interface ArgGroup {
		root: Argument;
		variants: Argument[];
		all: Argument[];
		groupScore: number;
	}

	type OpinionView = 'all' | 'supporters' | 'rejecters';

	interface Props {
		topGroups: ArgGroup[];
		poolGroups: ArgGroup[];
		totalArguments: number;
		/** Theses linked onto this thesis "as arguments" — rendered atop the list. */
		linkedTheses: ThesisEdgeHydrated[];
		pendingReorderCount: number;
		complexityCapped: boolean;
		opinionView: OpinionView;
		/** Has the viewer cast a thesis vote? Gates argument create/fork (matches the server). */
		hasThesisVote: boolean;
		onreorder: () => void;
		onopenarg: () => void;
		onfork: (source: Argument) => void;
		onedit: (target: Argument) => void;
		onunlink: (sourceId: string) => void;
		onneedthesisvote: () => void;
		onopinionchange: (view: OpinionView) => void;
	}

	let {
		topGroups,
		poolGroups,
		totalArguments,
		linkedTheses,
		pendingReorderCount,
		complexityCapped,
		opinionView,
		hasThesisVote,
		onreorder,
		onopenarg,
		onfork,
		onedit,
		onunlink,
		onneedthesisvote,
		onopinionchange
	}: Props = $props();

	// Adding an argument requires a thesis vote first (server gate). Without one,
	// nudge the user to the thesis rather than opening a form that would 403.
	function requestAddArg() {
		if (hasThesisVote) onopenarg();
		else onneedthesisvote();
	}

	// Local-only ignore list — no API call, no budget cost.
	let ignoredIds = $state(new Set<string>());

	let visibleTop = $derived(topGroups.filter((g) => !ignoredIds.has(g.root.id)));
	let visiblePool = $derived(poolGroups.filter((g) => !ignoredIds.has(g.root.id)));
	// Linked theses count as arguments in the tally (a thesis IS an argument here).
	let visibleTotal = $derived(totalArguments - ignoredIds.size + linkedTheses.length);

	let uid = $derived(getUserId());

	function ignore(id: string) {
		ignoredIds = new Set([...ignoredIds, id]);
	}

	function summaryOf(arg: Argument): VoteSummary {
		let support = 0, reject = 0, neutral = 0, voters = 0;
		for (const v of arg.votes) {
			const w = v.weight || 1;
			voters++;
			if (v.type === 'support') support += w;
			else if (v.type === 'reject') reject += w;
			else neutral += w;
		}
		return { support, reject, neutral, total: support + reject + neutral, voters };
	}

	function currentVoteOf(arg: Argument): VoteType | null {
		if (typeof window === 'undefined') return null;
		const v = arg.votes.find((vote) => vote.user_id === uid);
		return v ? v.type : null;
	}

	function currentWeightOf(arg: Argument): number {
		if (typeof window === 'undefined') return 1;
		const v = arg.votes.find((vote) => vote.user_id === uid);
		return v ? (v.weight || 1) : 1;
	}

	// Which companion argument is mid-request (guards double-submit per tile).
	let votingId = $state<string | null>(null);

	// Vote on a linked thesis via its companion argument — same endpoint and
	// behaviour as a native argument (satisfies "objects behave identically").
	// The companion is directionless; the vote goes to target_type='argument',
	// never to thesis B's own score.
	async function castLinkedVote(arg: Argument, type: VoteType, weight: number) {
		if (votingId) return;
		const existing = arg.votes.find((v) => v.user_id === uid);
		const isRetract = !!existing && existing.type === type && (existing.weight || 1) === weight;
		const chargeable = !isRetract && (type === 'support' || type === 'reject') && weight > 1;
		if (chargeable) {
			if (!budgetStore.canAffordWeight(weight)) { noticeStore.show(m.budget_weight_exhausted()); return; }
			budgetStore.spendWeight(weight);
		}
		votingId = arg.id;
		try {
			const res = await fetch(`/api/arguments/${arg.id}/vote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type, weight })
			});
			if (!res.ok) {
				if (chargeable) budgetStore.refundWeight(weight);
				if (res.status === 403) {
					const err = await res.json().catch(() => null);
					if (err?.code === 'thesis_vote_required') onneedthesisvote();
				}
				return;
			}
			const data = await res.json();
			const summary = data.vote_summary as VoteSummary;
			const newVote: VoteType | null = isRetract ? null : type;
			const newWeight = newVote ? weight : 1;
			if (newVote) markVotedArg(arg.id);

			// Rebuild votes from the server summary (single source of truth), placing
			// this user's vote so the widget reflects the retract/switch immediately.
			const votes = [
				...Array(summary.support).fill({ user_id: '', type: 'support', weight: 1, cast_at: '' }),
				...Array(summary.reject).fill({ user_id: '', type: 'reject', weight: 1, cast_at: '' }),
				...Array(summary.neutral).fill({ user_id: '', type: 'neutral', weight: 1, cast_at: '' })
			];
			if (newVote) {
				const idx = votes.findIndex((v) => v.type === newVote);
				if (idx >= 0) votes[idx] = { user_id: uid, type: newVote, weight: newWeight, cast_at: new Date().toISOString() };
			}
			arg.votes = votes;
		} finally {
			votingId = null;
		}
	}

	// A directional swipe on a linked-thesis tile = a vote in that direction,
	// climbing the Fibonacci weight if the same stance is already held (mirrors
	// ThesisCard.castSwipe, so swipe strengthens identically everywhere).
	function castLinkedSwipe(arg: Argument, type: 'support' | 'reject') {
		const held = arg.votes.find((v) => v.user_id === uid);
		const weight = held && held.type === type ? nextFibWeight(held.weight || 1) : 1;
		castLinkedVote(arg, type, weight);
	}
</script>

{#if pendingReorderCount > 0}
	<button
		type="button"
		class="reorder-chip"
		onclick={onreorder}
		title={m.reorder_apply_hint()}
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
		<span>{pendingReorderCount === 1
			? m.reorder_apply_one()
			: m.reorder_apply_many({ count: pendingReorderCount })}</span>
	</button>
{/if}

<div class="arguments-col">
	<div class="col-header">
		<h2 class="col-title">
			{m.argcol_arguments()}
			<span class="col-count">({visibleTotal})</span>
		</h2>
		<button
			class="btn btn-sm add-arg-btn"
			class:locked={!hasThesisVote}
			title={hasThesisVote ? undefined : m.thesis_vote_first_hint()}
			onclick={requestAddArg}
		>{m.argcol_add_arg()}</button>
	</div>
	<div class="segmented segmented--fill opinion-view" role="group" aria-label={m.opinion_view_label()}>
		<button class="segmented-btn" class:active={opinionView === 'all'} onclick={() => onopinionchange('all')}>{m.opinion_view_all()}</button>
		<button class="segmented-btn" class:active={opinionView === 'supporters'} onclick={() => onopinionchange('supporters')}>{m.opinion_view_supporters()}</button>
		<button class="segmented-btn" class:active={opinionView === 'rejecters'} onclick={() => onopinionchange('rejecters')}>{m.opinion_view_rejecters()}</button>
	</div>
	<div class="arguments-list">
		{#each linkedTheses as item (item.edge.id)}
			<div class="arg-row">
				{#if item.argument}
					<SwipeVote
						onSwipeRight={() => castLinkedSwipe(item.argument!, 'support')}
						onSwipeLeft={() => castLinkedSwipe(item.argument!, 'reject')}
						allowNeutral={false}
						positiveLabel={m.vote_agree()}
						negativeLabel={m.vote_disagree()}
						heldVote={currentVoteOf(item.argument)}
						heldWeight={currentWeightOf(item.argument)}
					>
						<div class="linked-tile">
							<a class="linked-tile-head" href="/thesis/{item.thesis.id}">
								<span class="linked-badge">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
									{m.linked_thesis_badge()}
								</span>
								<span class="linked-tile-title">{item.thesis.title}</span>
								<LifecycleIcon state={item.thesis.lifecycle.state} />
							</a>
							<div class="linked-tile-vote">
								<VoteRow
									summary={summaryOf(item.argument)}
									currentVote={currentVoteOf(item.argument)}
									currentWeight={currentWeightOf(item.argument)}
									voting={votingId === item.argument.id}
									compact
									hideNeutral
									agreeMode
									oncast={(type, weight) => castLinkedVote(item.argument!, type, weight)}
								/>
							</div>
						</div>
					</SwipeVote>
				{:else}
					<div class="linked-tile">
						<a class="linked-tile-head" href="/thesis/{item.thesis.id}">
							<span class="linked-badge">
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
								{m.linked_thesis_badge()}
							</span>
							<span class="linked-tile-title">{item.thesis.title}</span>
							<LifecycleIcon state={item.thesis.lifecycle.state} />
						</a>
					</div>
				{/if}
				{#if item.edge.author_id === uid}
					<button
						class="ignore-btn"
						onclick={() => onunlink(item.edge.source_thesis_id)}
						title={m.linked_thesis_remove()}
						aria-label={m.linked_thesis_remove()}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
					</button>
				{/if}
			</div>
		{/each}
		{#each visibleTop as g, idx (g.root.id)}
			<div class="arg-row">
				<ArgumentCard
					argument={g.root}
					leading={idx === 0 && linkedTheses.length === 0}
					variants={g.variants}
					{hasThesisVote}
					onFork={onfork}
					onEdit={onedit}
					onNeedThesisVote={onneedthesisvote}
				/>
				<button class="ignore-btn" onclick={() => ignore(g.root.id)} title="Ausblenden" aria-label="Argument ausblenden">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				</button>
			</div>
		{/each}
		{#if visibleTop.length === 0 && linkedTheses.length === 0}
			<p class="col-empty">{m.argcol_empty_support()}</p>
		{/if}
	</div>
</div>

<section class="argument-pool">
	<header class="argument-pool-head">
		<h3 class="argument-pool-title">{m.argpool_title()}</h3>
		<p class="argument-pool-hint">{m.argpool_hint()}</p>
	</header>
	{#if visiblePool.length === 0}
		<p class="argument-pool-empty">{m.argpool_empty()}</p>
	{:else}
		<ul class="argument-pool-list">
			{#each visiblePool as g (g.root.id)}
				<li class="argument-pool-item arg-row">
				<ArgumentCard
					argument={g.root}
					variants={g.variants}
					{hasThesisVote}
					onFork={onfork}
					onEdit={onedit}
					onNeedThesisVote={onneedthesisvote}
				/>
				<button class="ignore-btn" onclick={() => ignore(g.root.id)} title="Ausblenden" aria-label="Argument ausblenden">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if complexityCapped}
		<p class="complexity-note">{m.complexity_slider_hint()}</p>
	{/if}
</section>

<style>
	.reorder-chip {
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		border: 1px solid var(--color-primary);
		background: var(--color-surface);
		color: var(--color-primary);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		box-shadow: var(--shadow-sm);
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	.reorder-chip:hover {
		background: var(--color-primary);
		color: white;
	}

	.arguments-col {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0;
	}

	.col-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding-bottom: 0.375rem;
	}

	/* Spacing-only; visual style comes from the shared .segmented classes. */
	.opinion-view {
		margin-bottom: 1rem;
	}

	.col-title {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		font-size: var(--text-lg);
		font-weight: 700;
		margin: 0;
	}

	.col-count {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.add-arg-btn {
		font-size: var(--text-xs);
		font-weight: 500;
		padding: 0.25rem 0.625rem;
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.add-arg-btn:hover:not(:disabled) {
		background: var(--color-surface);
		color: var(--color-text);
	}

	/* Locked = no thesis vote yet. Still clickable (nudges to vote), but dimmed
	   with a lock affordance so it reads as "do the thesis vote first". */
	.add-arg-btn.locked {
		opacity: 0.6;
	}

	.arguments-list {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.arguments-list :global(.argument-card) {
		position: relative;
		z-index: 1;
	}

	/* Ignore button wrapper */
	.arg-row {
		position: relative;
	}

	/* A linked thesis rendered inside the argument list. Shares the argument-card
	   chrome (surface + border + radius + padding) so it reads as a sibling of the
	   arguments, but carries a "thesis" badge + lifecycle glyph. Unlike a native
	   argument its display text is the linked thesis title (content is empty), and
	   it is voted through its companion argument in the footer. */
	.linked-tile {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text);
	}

	.linked-tile-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-md);
		transition: color var(--transition-fast);
	}

	.linked-tile-head:hover .linked-tile-title {
		color: var(--color-primary);
	}

	.linked-tile-vote {
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border);
	}

	.linked-badge {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.65rem;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-primary);
		background: var(--color-primary-bg);
		border-radius: 9999px;
		padding: 0.15rem 0.5rem;
	}

	.linked-tile-title {
		font-size: var(--text-base);
		font-weight: 600;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ignore-btn {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		border: none;
		background: var(--color-bg);
		color: var(--color-text-light);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.ignore-btn:hover {
		background: var(--color-border);
		color: var(--color-text-muted);
	}

	.col-empty {
		font-size: var(--text-sm);
		color: var(--color-text-light);
		text-align: center;
		padding: 1.5rem 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.argument-pool {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--color-border);
	}

	.argument-pool-head {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.argument-pool-title {
		font-size: var(--text-base);
		font-weight: 600;
		margin: 0;
		color: var(--color-text-muted);
	}

	.argument-pool-hint {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		margin: 0;
	}

	.argument-pool-empty {
		font-size: var(--text-sm);
		color: var(--color-text-light);
		text-align: center;
		padding: 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		margin: 0;
	}

	.complexity-note {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--color-text-light);
		font-style: italic;
		margin: 0.5rem 0 0;
	}

	.argument-pool-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.75rem;
	}

	.argument-pool-item {
		position: relative;
	}
</style>
