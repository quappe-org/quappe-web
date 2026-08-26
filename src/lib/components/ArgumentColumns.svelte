<script lang="ts">
	import type { Argument } from '$lib/models/types';
	import ArgumentCard from '$lib/components/ArgumentCard.svelte';
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
		pendingReorderCount: number;
		complexityCapped: boolean;
		opinionView: OpinionView;
		onreorder: () => void;
		onopenarg: () => void;
		onfork: (source: Argument) => void;
		onedit: (target: Argument) => void;
		onneedthesisvote: () => void;
		onopinionchange: (view: OpinionView) => void;
	}

	let {
		topGroups,
		poolGroups,
		totalArguments,
		pendingReorderCount,
		complexityCapped,
		opinionView,
		onreorder,
		onopenarg,
		onfork,
		onedit,
		onneedthesisvote,
		onopinionchange
	}: Props = $props();

	// Local-only ignore list — no API call, no budget cost.
	let ignoredIds = $state(new Set<string>());

	let visibleTop = $derived(topGroups.filter((g) => !ignoredIds.has(g.root.id)));
	let visiblePool = $derived(poolGroups.filter((g) => !ignoredIds.has(g.root.id)));
	let visibleTotal = $derived(totalArguments - ignoredIds.size);

	function ignore(id: string) {
		ignoredIds = new Set([...ignoredIds, id]);
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
			onclick={onopenarg}
		>{m.argcol_add_arg()}</button>
	</div>
	<div class="opinion-view" role="group" aria-label={m.opinion_view_label()}>
		<button class="ov-btn" class:active={opinionView === 'all'} onclick={() => onopinionchange('all')}>{m.opinion_view_all()}</button>
		<button class="ov-btn" class:active={opinionView === 'supporters'} onclick={() => onopinionchange('supporters')}>{m.opinion_view_supporters()}</button>
		<button class="ov-btn" class:active={opinionView === 'rejecters'} onclick={() => onopinionchange('rejecters')}>{m.opinion_view_rejecters()}</button>
	</div>
	<div class="arguments-list">
		{#each visibleTop as g, idx (g.root.id)}
			<div class="arg-row">
				<ArgumentCard
					argument={g.root}
					leading={idx === 0}
					variants={g.variants}
					onFork={onfork}
					onEdit={onedit}
					onNeedThesisVote={onneedthesisvote}
				/>
				<button class="ignore-btn" onclick={() => ignore(g.root.id)} title="Ausblenden" aria-label="Argument ausblenden">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				</button>
			</div>
		{/each}
		{#if visibleTop.length === 0}
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
		padding: 0.875rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
	}

	.col-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding-bottom: 0.375rem;
	}

	.opinion-view {
		display: inline-flex;
		gap: 2px;
		background: var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.ov-btn {
		padding: 0.55rem 1.1rem;
		font-size: var(--text-sm);
		font-weight: 500;
		font-family: inherit;
		background: var(--color-surface);
		color: var(--color-text-muted);
		border: none;
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.ov-btn:hover {
		color: var(--color-text);
	}

	.ov-btn.active {
		background: var(--color-primary-bg);
		color: var(--color-primary);
		font-weight: 600;
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
		background: transparent;
		color: var(--color-text-light);
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
	}

	.arg-row:hover .ignore-btn,
	.arg-row:focus-within .ignore-btn {
		opacity: 1;
	}

	.ignore-btn:hover {
		background: var(--color-bg);
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
