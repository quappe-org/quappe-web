<script lang="ts">
	import type { Thesis } from '$lib/models/types';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		query: string;
		results: Thesis[];
		mode: 'semantic' | 'fulltext' | 'combined' | 'empty' | null;
		searching: boolean;
	}

	let {
		query = $bindable(''),
		results = $bindable<Thesis[]>([]),
		mode = $bindable<'semantic' | 'fulltext' | 'combined' | 'empty' | null>(null),
		searching = $bindable(false)
	}: Props = $props();

	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	function onSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		const q = query.trim();
		if (q.length < 2) {
			results = [];
			mode = null;
			searching = false;
			return;
		}
		searching = true;
		searchTimer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
				if (res.ok) {
					const data = await res.json();
					results = data.results ?? [];
					mode = data.mode ?? null;
				}
			} finally {
				searching = false;
			}
		}, 300);
	}
</script>

<div class="search-wrap">
	<div class="search-box">
		<svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
		<input
			type="search"
			class="search-input"
			placeholder={m.home_search_placeholder()}
			bind:value={query}
			oninput={onSearchInput}
			maxlength="200"
		/>
		{#if searching}
			<span class="search-spinner" aria-label={m.home_search_searching_aria()}></span>
		{/if}
	</div>
</div>

<style>
	.search-wrap {
		position: relative;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 0.85rem 1.1rem;
		box-shadow: var(--shadow-sm);
		transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
	}

	.search-box:focus-within {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px var(--color-primary-bg);
	}

	.search-icon {
		color: var(--color-text-light);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: var(--text-lg);
		color: var(--color-text);
		outline: none;
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--color-text-light);
	}

	.search-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
