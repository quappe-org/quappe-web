<script lang="ts">
	import { onMount } from 'svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
	import { m } from '$lib/paraglide/messages';

	let bannerText = $state('');
	let saved = $state(false);
	let loading = $state(true);
	let newCategory = $state('');

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

	function addCategory() {
		const cat = newCategory.trim().toLowerCase();
		if (cat) {
			categoriesStore.add(cat);
			newCategory = '';
		}
	}

	function removeCategory(cat: string) {
		categoriesStore.remove(cat);
	}

	function resetCategories() {
		categoriesStore.reset();
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
			<div class="setting-header">
				<h3 class="setting-label">{m.settings_categories_title()}</h3>
				<button class="btn btn-sm" onclick={resetCategories}>{m.settings_bounds_reset()}</button>
			</div>
			<p class="setting-hint">{m.settings_categories_hint()}</p>
		</div>

		<div class="categories-list">
			{#each categoriesStore.list as cat}
				<div class="category-item">
					<span class="tag">{cat}</span>
					<button class="remove-btn" onclick={() => removeCategory(cat)} title={m.settings_categories_remove_title()}>&times;</button>
				</div>
			{/each}
		</div>

		<form class="add-category-form" onsubmit={(e) => { e.preventDefault(); addCategory(); }}>
			<input type="text" bind:value={newCategory} placeholder={m.settings_categories_new_placeholder()} class="category-input" />
			<button class="btn btn-primary btn-sm" type="submit" disabled={!newCategory.trim()}>{m.settings_categories_add()}</button>
		</form>
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

	.setting-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
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

	.categories-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.category-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.remove-btn {
		background: none;
		border: none;
		font-size: 1rem;
		color: var(--color-text-light);
		cursor: pointer;
		padding: 0 0.15rem;
		line-height: 1;
	}

	.remove-btn:hover {
		color: var(--color-reject);
	}

	.add-category-form {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.category-input {
		flex: 1;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--text-sm);
		background: var(--color-bg);
		color: var(--color-text);
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
