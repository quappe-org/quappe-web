<script lang="ts">
	import { onMount } from 'svelte';

	// Fires `onVisible` when the sentinel scrolls into view. Used for infinite
	// scroll: place it just below a list; when it enters the viewport, load more.
	let { onVisible, rootMargin = '400px' }: { onVisible: () => void; rootMargin?: string } = $props();

	let el: HTMLDivElement;

	onMount(() => {
		if (typeof IntersectionObserver === 'undefined') return;
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) onVisible();
				}
			},
			{ rootMargin }
		);
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<div bind:this={el} class="scroll-sentinel" aria-hidden="true"></div>

<style>
	.scroll-sentinel {
		height: 1px;
		width: 100%;
	}
</style>
