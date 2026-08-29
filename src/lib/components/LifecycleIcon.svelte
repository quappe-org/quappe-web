<script lang="ts">
	import type { LifecycleState } from '$lib/models/types';

	// One small glyph per lifecycle state. currentColor + aria-hidden so it
	// inherits the eyebrow's colour and never announces itself to screen
	// readers — the adjacent state word is the accessible label. Kept purely
	// decorative on purpose: in calm mode the icon is hidden and the word stays.
	let { state, size = 12 }: { state: LifecycleState; size?: number } = $props();
</script>

<svg
	class="lifecycle-icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if state === 'seedling'}
		<!-- sprout: a shoot with two leaves -->
		<path d="M12 21v-8" />
		<path d="M12 13c0-3-2-5-5-5 0 3 2 5 5 5z" />
		<path d="M12 11c0-2.5 2-4.5 5-4.5 0 2.5-2 4.5-5 4.5z" />
	{:else if state === 'discussed'}
		<!-- two chat bubbles: healthy back-and-forth -->
		<path d="M8 10h7" />
		<path d="M4 6h11a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H9l-4 3v-3H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
	{:else if state === 'contested'}
		<!-- opposing arrows: polarised -->
		<path d="M4 9l4-4 4 4" />
		<path d="M8 5v6" />
		<path d="M20 15l-4 4-4-4" />
		<path d="M16 19v-6" />
	{:else if state === 'crystallized'}
		<!-- diamond: a settled, faceted position -->
		<path d="M6 3h12l3 6-9 12L3 9z" />
		<path d="M3 9h18" />
		<path d="M12 3v6" />
	{:else if state === 'faded'}
		<!-- dashed circle: activity thinning out -->
		<path d="M12 3a9 9 0 0 1 6 2.3" />
		<path d="M21 9a9 9 0 0 1 0 6" />
		<path d="M18 18.7A9 9 0 0 1 12 21" />
		<path d="M6 18.7A9 9 0 0 1 3 12" />
		<path d="M4.5 6.5A9 9 0 0 1 9 3.3" />
	{:else}
		<!-- moon: dormant, cold reference -->
		<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />
	{/if}
</svg>

<style>
	.lifecycle-icon {
		flex-shrink: 0;
		display: inline-block;
		vertical-align: -0.1em;
		/* The eyebrow text is deliberately muted; nudge the glyph a touch clearer
		   so it reads as a distinct signal rather than vanishing into the label. */
		color: var(--color-text-muted);
	}

	/* Calm mode treats the icon as decoration: hide it, keep the state word. */
	:global([data-calm='true']) .lifecycle-icon {
		display: none;
	}
</style>
