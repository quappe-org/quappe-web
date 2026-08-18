<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	let bannerText = $state('');
	let saved = $state(false);
	let loading = $state(true);

	onMount(async () => {
		const res = await fetch('/api/admin/banner');
		if (res.ok) {
			const data = await res.json();
			bannerText = data.text ?? '';
		}
		loading = false;
	});

	async function saveBanner() {
		const res = await fetch('/api/admin/banner', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: bannerText })
		});
		if (res.ok) {
			saved = true;
			setTimeout(() => { saved = false; }, 2000);
		}
	}
</script>

<section class="stack-lg">
	<h1 class="page-title">Admin</h1>

	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">Site Banner</h3>
			<p class="setting-hint">Shown at the top of every page when non-empty. Use for draft notices, maintenance announcements, etc.</p>
		</div>
		{#if !loading}
			<textarea
				class="banner-input"
				bind:value={bannerText}
				placeholder="e.g. This is a draft — all data will be reset before launch."
				rows="3"
			></textarea>
			<div class="banner-actions">
				<button class="btn btn-primary btn-sm" onclick={saveBanner}>Save</button>
				{#if saved}<span class="saved-hint">Saved</span>{/if}
				{#if bannerText}
					<button class="btn btn-sm" onclick={() => { bannerText = ''; saveBanner(); }}>Clear</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">Logs</h3>
			<p class="setting-hint">Live server log viewer.</p>
		</div>
		<a href="/admin/logs" class="admin-link">Open log viewer</a>
	</div>
</section>

<style>
	.page-title {
		font-family: var(--font-serif);
		font-size: 1.5rem;
		font-weight: 600;
	}

	.banner-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--text-sm);
		resize: vertical;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.banner-input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px var(--color-primary-bg);
	}

	.banner-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.saved-hint {
		font-size: var(--text-sm);
		color: var(--color-support);
		font-weight: 500;
	}

	.admin-link {
		font-size: var(--text-sm);
		color: var(--color-primary);
		text-decoration: none;
		font-weight: 500;
	}

	.admin-link:hover {
		text-decoration: underline;
	}
</style>
