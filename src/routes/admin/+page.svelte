<script lang="ts">
	import { onMount } from 'svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
	import { adminSecret } from '$lib/stores/admin-secret.svelte';
	import { m } from '$lib/paraglide/messages';

	let bannerText = $state('');
	let saved = $state(false);
	let loading = $state(true);
	let newCategory = $state('');
	let authError = $state(false);
	let secretInput = $state('');

	interface UserStats {
		total_users: number;
		daily: { day: string; voters: number; votes: number }[];
	}
	let stats = $state<UserStats | null>(null);

	async function loadAdminData() {
		authError = false;
		// Banner GET is public; used to prefill the editor.
		const res = await fetch('/api/admin/banner');
		if (res.ok) {
			const data = await res.json();
			bannerText = data.text ?? '';
		}
		loading = false;

		// Stats require admin — surfaces whether the secret is valid.
		const statsRes = await fetch('/api/admin/users?days=30', { headers: adminSecret.headers() });
		if (statsRes.status === 403) {
			authError = true;
			stats = null;
			return;
		}
		if (statsRes.ok) {
			stats = await statsRes.json();
		}
	}

	onMount(loadAdminData);

	function submitSecret() {
		adminSecret.set(secretInput);
		secretInput = '';
		loadAdminData();
	}

	async function saveBanner() {
		const res = await fetch('/api/admin/banner', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', ...adminSecret.headers() },
			body: JSON.stringify({ text: bannerText })
		});
		if (res.status === 403) {
			authError = true;
			return;
		}
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
			<h3 class="setting-label">Operator access</h3>
			<p class="setting-hint">
				Admin actions (banner, stats, logs, archiving) require the operator secret
				(QUAPPE_ADMIN_SECRET). It's kept for this browser session only.
			</p>
		</div>
		{#if authError}
			<p class="auth-error">Secret missing or invalid — admin actions are locked.</p>
		{/if}
		<form class="secret-form" onsubmit={(e) => { e.preventDefault(); submitSecret(); }}>
			<input
				type="password"
				bind:value={secretInput}
				placeholder={adminSecret.secret ? '•••••••• (set — re-enter to change)' : 'Enter admin secret'}
				class="secret-input"
				autocomplete="off"
			/>
			<button class="btn btn-primary btn-sm" type="submit" disabled={!secretInput.trim()}>Unlock</button>
			{#if adminSecret.secret}
				<button class="btn btn-sm" type="button" onclick={() => adminSecret.clear()}>Clear</button>
			{/if}
		</form>
	</div>

	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">Users & Activity</h3>
			<p class="setting-hint">Anonymous identities leave a trace once they vote. Totals reflect distinct voters.</p>
		</div>
		{#if stats}
			<div class="stat-total">
				<span class="stat-num">{stats.total_users}</span>
				<span class="stat-label">total users (distinct voters)</span>
			</div>
			<table class="stat-table">
				<thead>
					<tr>
						<th>Day</th>
						<th class="num">Voters</th>
						<th class="num">Votes</th>
					</tr>
				</thead>
				<tbody>
					{#each stats.daily as row}
						<tr>
							<td>{row.day}</td>
							<td class="num">{row.voters}</td>
							<td class="num">{row.votes}</td>
						</tr>
					{/each}
					{#if stats.daily.length === 0}
						<tr><td colspan="3" class="empty">No votes yet.</td></tr>
					{/if}
				</tbody>
			</table>
		{:else}
			<p class="setting-hint">Loading…</p>
		{/if}
	</div>

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

	.secret-form {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.secret-input {
		flex: 1;
		min-width: 12rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--text-sm);
		background: var(--color-bg);
		color: var(--color-text);
	}

	.auth-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-reject);
		font-weight: 500;
	}

	.stat-total {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.stat-num {
		font-size: var(--text-2xl);
		font-weight: 700;
		font-family: var(--font-mono);
		color: var(--color-primary);
	}

	.stat-label {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.stat-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	.stat-table th,
	.stat-table td {
		padding: 0.35rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}

	.stat-table th {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.stat-table td {
		font-family: var(--font-mono);
	}

	.stat-table .num {
		text-align: right;
	}

	.stat-table .empty {
		text-align: center;
		color: var(--color-text-light);
		font-family: inherit;
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
