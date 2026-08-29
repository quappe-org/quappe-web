<script lang="ts">
	import type { Snippet } from 'svelte';

	// Shared popup shell. Consolidates the surface/backdrop/close behaviour that
	// was reimplemented in the header popovers, the Wizard, and the vote-nudge.
	// Content lives in the caller (children snippet); this owns only the shell.
	//
	// Variants:
	//  - modal   → centred card over a dimmed backdrop (the mobile default too).
	//  - drawer  → right-anchored full-height panel (mobile primary-nav shape).
	//  - sheet   → large compose surface for long-form writing: a roomy centred
	//              card on desktop, a full-viewport sheet on mobile. Use for
	//              create/edit forms where the input is the main task.
	//  - anchored→ transparent-backdrop popover positioned by the caller's own
	//              wrapper (desktop header popovers): we render only the card +
	//              a click-catcher, positioning is the caller's CSS concern.
	type Variant = 'modal' | 'drawer' | 'sheet' | 'anchored';

	interface Props {
		open: boolean;
		variant?: Variant;
		/** Dimmed backdrop (modal/drawer default true; anchored default false). */
		dim?: boolean;
		/** Called when the user requests close (backdrop click / Escape). */
		onclose?: () => void;
		/** Close on backdrop click. Off for forms with unsaved input. */
		backdropClose?: boolean;
		/** Close on Escape. Off for sticky flows like onboarding. */
		escClose?: boolean;
		/** Extra class applied to the card, for per-popup sizing. */
		cardClass?: string;
		labelledby?: string;
		children: Snippet;
	}

	let {
		open,
		variant = 'modal',
		dim,
		onclose,
		backdropClose = true,
		escClose = true,
		cardClass = '',
		labelledby,
		children
	}: Props = $props();

	const dimmed = $derived(dim ?? variant !== 'anchored');

	function onKeydown(e: KeyboardEvent) {
		if (escClose && e.key === 'Escape') onclose?.();
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<div class="popup-backdrop popup-{variant}" class:dimmed>
		<!-- Full-screen click-catcher for outside-click close. Sits behind the
		     card; the card is a sibling so clicks on it don't bubble here.
		     Rendered only when backdrop-close is allowed. -->
		{#if backdropClose}
			<button type="button" class="popup-catcher" aria-label="Close" onclick={onclose}></button>
		{/if}
		<div class="popup-card {cardClass}" role="dialog" aria-modal={variant !== 'anchored'} aria-labelledby={labelledby}>
			{@render children()}
		</div>
	</div>
{/if}

<style>
	.popup-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
	}
	.popup-backdrop.dimmed {
		background: rgba(0, 0, 0, 0.4);
	}

	/* Full-screen invisible close button behind the card. */
	.popup-catcher {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: transparent;
		border: none;
		padding: 0;
		margin: 0;
		cursor: default;
	}

	/* Centred modal card. */
	.popup-modal {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.popup-modal .popup-card {
		position: relative;
		z-index: 1;
		width: min(92vw, 22rem);
		max-height: 85dvh;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 1.1rem 1.2rem;
	}

	/* Sheet: a roomy compose surface for long-form writing. Desktop = a large
	   centred card (wide + tall enough that the main input feels prominent, not
	   cramped). Mobile = a full-viewport sheet, like a native compose window.
	   The card is a flex column so a caller's sticky footer pins to its bottom. */
	.popup-sheet {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.popup-sheet .popup-card {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		width: min(94vw, 52rem);
		height: min(88dvh, 44rem);
		max-height: 88dvh;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 1.5rem 1.6rem;
	}

	@media (max-width: 768px) {
		.popup-sheet {
			padding: 0;
		}
		.popup-sheet .popup-card {
			width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			border: none;
			border-radius: 0;
			padding: max(1rem, env(safe-area-inset-top, 0)) 1.2rem
				max(1rem, env(safe-area-inset-bottom, 0));
		}
	}

	/* Right-anchored full-height drawer. */
	.popup-drawer {		display: flex;
		justify-content: flex-end;
	}
	.popup-drawer .popup-card {
		position: relative;
		z-index: 1;
		width: min(88vw, 20rem);
		height: 100dvh;
		max-height: 100dvh;
		overflow-y: auto;
		background: var(--color-surface);
		border-left: 1px solid var(--color-border);
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.15);
		padding: max(1rem, env(safe-area-inset-top, 0)) 1.2rem env(safe-area-inset-bottom, 0);
	}

	/* Anchored: transparent click-catcher; caller positions the card. */
	.popup-anchored {
		background: transparent;
	}
	.popup-anchored .popup-card {
		position: absolute;
		z-index: 1;
	}
</style>
