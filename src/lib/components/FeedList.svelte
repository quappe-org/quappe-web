<script lang="ts">
	import type { Thesis } from '$lib/models/types';
	import { type UpdateGroup } from '$lib/stores/updates.svelte';
	import ThesisCard from '$lib/components/ThesisCard.svelte';
	import SwipeVote from '$lib/components/SwipeVote.svelte';
	import ScrollSentinel from '$lib/components/ScrollSentinel.svelte';
	import { m } from '$lib/paraglide/messages';

	type FeedItem =
		| { kind: 'update_group'; at: string; sortKey: number; group: UpdateGroup }
		| { kind: 'new_thesis'; at: string; sortKey: number; thesis: Thesis };

	interface FeedGroup {
		key: string;
		label: string;
		items: FeedItem[];
	}

	interface Props {
		feedGroups: FeedGroup[];
		feedItems: FeedItem[];
		feedShown: number;
		heat: Record<string, number>;
		argumentCounts: Record<string, number>;
		justVotedFadingOut: Set<string>;
		onnote: (thesisId: string) => void;
		onmarkread: (group: UpdateGroup) => void;
		ondismiss: (group: UpdateGroup) => void;
		onloadmore: () => void;
	}

	let {
		feedGroups,
		feedItems,
		feedShown,
		heat,
		argumentCounts,
		justVotedFadingOut,
		onnote,
		onmarkread,
		ondismiss,
		onloadmore
	}: Props = $props();

	// Local-only ignore for new_thesis tiles (no API call).
	let ignoredNewThesisIds = $state(new Set<string>());

	function ignoreThesis(id: string) {
		ignoredNewThesisIds = new Set([...ignoredNewThesisIds, id]);
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
</script>

{#if feedItems.length === 0}
	<div class="feed-empty card">
		<p><strong>{m.feed_empty_head()}</strong></p>
		<p>{m.feed_empty_body()}</p>
	</div>
{:else}
	{#each feedGroups as group (group.key)}
		<div class="time-divider">{group.label}</div>
		<div class="feed-list">
			{#each group.items as item (item.kind === 'update_group' ? `g:${item.group.thesis_id}` : `t:${item.thesis.id}`)}
				{#if item.kind === 'new_thesis' && !ignoredNewThesisIds.has(item.thesis.id)}
					<div class="feed-tile" class:just-voted={justVotedFadingOut.has(item.thesis.id)}>
						<span class="feed-new-badge">{m.feed_new_thesis_badge()}</span>
						<ThesisCard
							thesis={item.thesis}
							heatRatio={heat[item.thesis.id] ?? 0}
							argumentCount={argumentCounts[item.thesis.id] ?? 0}
							onvoted={() => onnote(item.thesis.id)}
						/>
						<button class="tile-dismiss" onclick={() => ignoreThesis(item.thesis.id)} title="Ausblenden" aria-label="Ausblenden">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
						</button>
					</div>
				{:else if item.kind === 'update_group'}
					{@const g = item.group}
					<div class="feed-tile">
						<SwipeVote
							onSwipeRight={() => onmarkread(g)}
							onSwipeLeft={() => ondismiss(g)}
							allowNeutral={false}
							positiveLabel={m.updates_swipe_read()}
							negativeLabel={m.updates_swipe_dismiss()}
							positiveColor="var(--color-primary)"
							negativeColor="var(--color-text-light)"
						>
							<a
								class="updates-group card"
								class:is-read={g.read}
								href="/thesis/{g.thesis_id}"
								onclick={() => onmarkread(g)}
							>
								<div class="updates-group-row">
									<span class="updates-group-title">{g.thesis_title}</span>
									{#if !g.read}<span class="unread-dot" aria-label={m.updates_unread()}></span>{/if}
								</div>
								<div class="updates-group-chips">
									{#if g.new_arguments > 0}
										<span class="updates-chip updates-chip-new_argument" title={m.updates_type_newarg()}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
											<span>{g.new_arguments === 1
												? m.updates_group_new_arguments_one()
												: m.updates_group_new_arguments_many({ count: g.new_arguments })}</span>
										</span>
									{/if}
									{#if g.forks > 0}
										<span class="updates-chip updates-chip-fork" title={m.updates_type_fork()}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="3" r="2"></circle><circle cx="6" cy="21" r="2"></circle><circle cx="18" cy="12" r="2"></circle><path d="M18 10V8a2 2 0 0 0-2-2H8M6 5v14"></path></svg>
											<span>{g.forks === 1
												? m.updates_group_forks_one()
												: m.updates_group_forks_many({ count: g.forks })}</span>
										</span>
									{/if}
									{#if g.lifecycle_state}
										<span class="updates-chip updates-chip-lifecycle" title={m.updates_type_lifecycle()}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
											<span>{m.updates_group_lifecycle({ state: g.lifecycle_state })}</span>
										</span>
									{/if}
									<time class="updates-group-time">{fmtTime(g.last_at)}</time>
								</div>
							</a>
						</SwipeVote>
						<button class="tile-dismiss" onclick={() => ondismiss(g)} title="Ausblenden" aria-label="Ausblenden">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
						</button>
					</div>
				{/if}
			{/each}
		</div>
	{/each}

	{#if feedItems.length > feedShown}
		<ScrollSentinel onVisible={onloadmore} />
		<div class="feed-refresh">
			<button class="btn btn-sm" onclick={onloadmore}>{m.my_load_more()}</button>
		</div>
	{/if}
{/if}

<style>
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

	.feed-tile {
		position: relative;
		transition: opacity 1.4s ease, transform 1.4s ease;
	}
	.feed-tile.just-voted {
		opacity: 0.35;
		transform: scale(0.98);
		pointer-events: none;
	}

	.tile-dismiss {
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
	.tile-dismiss:hover {
		background: var(--color-border);
		color: var(--color-text-muted);
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

	.updates-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		position: relative;
		padding: 0.75rem 1rem;
		border-left: 3px solid var(--color-primary);
		text-decoration: none;
		color: inherit;
		transition: opacity var(--transition-base), background var(--transition-base);
	}
	.updates-group:hover {
		background: var(--color-bg);
	}
	.updates-group.is-read {
		opacity: 0.55;
		border-left-color: var(--color-border);
	}

	.updates-group-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.updates-group-title {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
	.updates-group:hover .updates-group-title {
		color: var(--color-primary);
	}

	.updates-group-chips {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: var(--text-xs);
	}
	.updates-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-weight: 500;
		white-space: nowrap;
	}
	.updates-chip-new_argument {
		background: var(--color-primary-bg);
		color: var(--color-primary);
	}
	.updates-chip-fork {
		background: #ffedd5;
		color: #9a3412;
	}
	.updates-chip-lifecycle {
		background: #ede9fe;
		color: #5b21b6;
	}
	.updates-group-time {
		font-family: var(--font-mono);
		color: var(--color-text-light);
		flex-shrink: 0;
		margin-left: auto;
	}

	.unread-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-primary);
		flex-shrink: 0;
	}

	.feed-refresh {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1.5rem 1rem;
		text-align: center;
	}
</style>
