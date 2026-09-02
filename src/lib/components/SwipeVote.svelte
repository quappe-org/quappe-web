<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { VoteType } from '$lib/models/types';
	import { nextFibWeight } from '$lib/models/fibonacci';
	import { onMount } from 'svelte';

	interface Props {
		children: Snippet;
		// Vote mode (backwards compatible): fires with 'support' or 'reject'.
		oncast?: (type: VoteType, weight: number) => void;
		// Generic-action mode: raw left/right callbacks. If either is given,
		// it takes precedence over oncast for that direction. Used by feeds
		// where a swipe means "mark read" (right) or "dismiss" (left), not
		// a support/reject vote.
		onSwipeRight?: () => void;
		onSwipeLeft?: () => void;
		enabled?: boolean;
		allowNeutral?: boolean; // double-tap → neutral (theses only; off for arguments)
		positiveLabel?: string;
		negativeLabel?: string;
		positiveColor?: string; // override the tint (defaults to support green)
		negativeColor?: string;
		// The stance the viewer already holds + its weight. Used only to PREVIEW
		// the Fibonacci weight a completing swipe would land on (e.g. "✓ support ×3"
		// when re-swiping a held ×2). Purely cosmetic — the actual climb is decided
		// by the caller's cast handler; this just mirrors it in the drag overlay.
		heldVote?: VoteType | null;
		heldWeight?: number;
	}

	let {
		children,
		oncast,
		onSwipeRight,
		onSwipeLeft,
		enabled = true,
		allowNeutral = true,
		positiveLabel = 'support',
		negativeLabel = 'reject',
		positiveColor = 'var(--color-support)',
		negativeColor = 'var(--color-reject)',
		heldVote = null,
		heldWeight = 1
	}: Props = $props();

	let root = $state<HTMLElement | null>(null);
	let dx = $state(0);
	let dragging = $state(false);
	let isTouch = $state(false);
	let startX = 0;
	let startY = 0;
	let lastTapAt = 0;
	let lastTapX = 0;
	let lastTapY = 0;
	let pointerActive = false;
	let axisLocked: 'x' | 'y' | null = null;
	// Set true when a swipe casts, so the synthesised click that follows a drag
	// is swallowed (prevents an <a href> child from navigating on swipe).
	let suppressClick = false;

	const SWIPE_THRESHOLD = 60;
	const DOUBLE_TAP_MS = 300;
	const TAP_MAX_MOVE = 10;

	onMount(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(pointer: coarse)');
		isTouch = mq.matches;
		const listener = (e: MediaQueryListEvent) => (isTouch = e.matches);
		mq.addEventListener?.('change', listener);
		return () => mq.removeEventListener?.('change', listener);
	});

	function onPointerDown(e: PointerEvent) {
		if (!enabled || !isTouch || e.pointerType === 'mouse') return;
		pointerActive = true;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		axisLocked = null;
	}

	function onPointerMove(e: PointerEvent) {
		if (!pointerActive || !isTouch) return;
		const rawDx = e.clientX - startX;
		const rawDy = e.clientY - startY;

		if (!axisLocked) {
			// Wait for meaningful motion before deciding axis
			if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
			// Horizontal wins only if clearly dominant — otherwise let scroll happen
			if (Math.abs(rawDx) > Math.abs(rawDy) * 1.5) {
				axisLocked = 'x';
				dragging = true;
			} else {
				axisLocked = 'y';
				pointerActive = false; // release: user is scrolling
				return;
			}
		}
		if (axisLocked !== 'x') return;
		e.preventDefault();
		dx = rawDx;
	}

	function onPointerUp(e: PointerEvent) {
		if (!isTouch) return;
		const wasDragging = dragging;
		const finalDx = dx;
		pointerActive = false;
		dragging = false;
		dx = 0;

		// Swipe cast
		if (wasDragging && Math.abs(finalDx) >= SWIPE_THRESHOLD) {
			// A completed swipe must NOT also fire the wrapped element's click
			// (e.g. an <a href> navigating away). Swallow the next click in the
			// capture phase. Needed for mouse/DevTools emulation especially, where
			// a click is synthesised even after a dragging pointerup.
			suppressClick = true;
			if (finalDx > 0) {
				// Right: prefer generic action, fall back to support vote.
				if (onSwipeRight) onSwipeRight();
				else oncast?.('support', 1);
			} else {
				if (onSwipeLeft) onSwipeLeft();
				else oncast?.('reject', 1);
			}
			lastTapAt = 0;
			return;
		}

		// Double-tap → neutral (only if pointer barely moved, and neutral allowed)
		if (allowNeutral && !wasDragging && Math.abs(e.clientX - startX) < TAP_MAX_MOVE && Math.abs(e.clientY - startY) < TAP_MAX_MOVE) {
			const now = performance.now();
			if (
				now - lastTapAt < DOUBLE_TAP_MS &&
				Math.abs(e.clientX - lastTapX) < TAP_MAX_MOVE &&
				Math.abs(e.clientY - lastTapY) < TAP_MAX_MOVE
			) {
				oncast?.('neutral', 1);
				lastTapAt = 0;
			} else {
				lastTapAt = now;
				lastTapX = e.clientX;
				lastTapY = e.clientY;
			}
		}
	}

	function onPointerCancel() {
		pointerActive = false;
		dragging = false;
		dx = 0;
	}

	// Capture-phase: eat the click that a completed swipe would otherwise trigger
	// on a child link/button. One-shot — clears itself so normal taps still work.
	function onClickCapture(e: MouseEvent) {
		if (suppressClick) {
			e.preventDefault();
			e.stopPropagation();
			suppressClick = false;
		}
	}

	let tintOpacity = $derived(Math.min(0.35, Math.abs(dx) / 300));
	let tintColor = $derived(
		dx > 0 ? positiveColor : dx < 0 ? negativeColor : 'transparent'
	);
	// The Fibonacci weight a completing swipe would land on, for the current drag
	// direction: climbs only when the viewer already holds THIS side; otherwise a
	// fresh vote starts at 1. Mirrors the caller's cast logic so the overlay's ×N
	// preview matches what actually happens on release.
	let projectedWeight = $derived.by(() => {
		const dir: VoteType = dx > 0 ? 'support' : 'reject';
		return heldVote === dir ? nextFibWeight(heldWeight || 1) : 1;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="swipe-vote"
	class:swipe-active={dragging}
	bind:this={root}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerCancel}
	onclickcapture={onClickCapture}
	style="--dx: {dx}px; --tint-opacity: {tintOpacity}; --tint-color: {tintColor}"
>
	{@render children()}
	{#if dragging && Math.abs(dx) > 20}
		<div class="swipe-overlay" aria-hidden="true">
			<span class="swipe-label" style="color: {tintColor}">
				{#if dx > 0}✓ {positiveLabel}{:else}✗ {negativeLabel}{/if}
				{#if heldVote && projectedWeight > 1}<span class="swipe-weight" style="background: {tintColor}">×{projectedWeight}</span>{/if}
			</span>
		</div>
	{/if}
</div>

<style>
	.swipe-vote {
		position: relative;
		touch-action: pan-y;
		/* Establish a stacking context so the tint layer (::after) reliably
		   paints ABOVE the wrapped card even when the card sets its own
		   position/z-index inside. Fixes argument-card swipe having no
		   visible color feedback. */
		isolation: isolate;
	}

	.swipe-active {
		transform: translateX(var(--dx));
		transition: transform 0.02s linear;
	}

	.swipe-vote:not(.swipe-active) {
		transition: transform 0.18s ease-out;
		transform: translateX(0);
	}

	.swipe-vote::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--tint-color);
		opacity: var(--tint-opacity, 0);
		pointer-events: none;
		z-index: 2;
		transition: opacity 0.1s;
	}

	.swipe-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		font-weight: 700;
		font-size: 1.1rem;
		z-index: 3;
	}

	.swipe-label {
		background: rgba(255, 255, 255, 0.92);
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	/* Projected Fibonacci weight the swipe will land on (×2/×3/×5/×8). The pill
	   background is the stance colour (set inline from tintColor); white text for
	   contrast. A filled chip so the climb reads at a glance during the drag. */
	.swipe-weight {
		margin-left: 0.35rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 0.85em;
		font-weight: 700;
		color: #fff;
	}
</style>
