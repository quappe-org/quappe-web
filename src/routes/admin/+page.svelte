<script lang="ts">
	import { onMount } from 'svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
	import { adminSecret } from '$lib/stores/admin-secret.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { m } from '$lib/paraglide/messages';

	let bannerText = $state('');
	let saved = $state(false);
	let loading = $state(true);
	let newCategory = $state('');
	let authError = $state(false);
	let secretInput = $state('');
	// Full-page gate: no admin UI is rendered until we've verified either the
	// admin secret (via a stats probe) or a gated-mode admin role. The old
	// "unlock box at the top" let visitors see the categories editor even when
	// the header they had was wrong — that's the bug the user hit.
	let authorized = $state(false);
	let probing = $state(true);
	let gateError = $state<string | null>(null);

	interface UserStats {
		total_users: number;
		daily: { day: string; voters: number; votes: number }[];
	}
	let stats = $state<UserStats | null>(null);

	// Probe whether the current credentials (header secret or gated-mode
	// admin role from the cookie) get us past requireAdmin. This is the sole
	// gate: everything else on the page is behind `authorized`. Records the last
	// HTTP status so the gate can tell "wrong secret" (403) apart from "throttled"
	// (429) after too many failed attempts.
	let lastProbeStatus = $state(0);
	async function probeAuth(): Promise<boolean> {
		const res = await fetch('/api/admin/users?days=30', { headers: adminSecret.headers() });
		lastProbeStatus = res.status;
		if (res.ok) {
			stats = await res.json();
			return true;
		}
		return false;
	}

	async function loadAdminData() {
		authError = false;
		// Banner GET is public; used to prefill the editor.
		const bannerRes = await fetch('/api/admin/banner');
		if (bannerRes.ok) {
			const data = await bannerRes.json();
			bannerText = data.text ?? '';
		}
		loading = false;
	}

	async function initGate() {
		probing = true;
		// In gated mode, an admin role from the auth cookie is enough — no
		// header needed. Otherwise we need a stored secret to try.
		if (authStore.role === 'admin' || adminSecret.secret) {
			authorized = await probeAuth();
			if (authorized) await loadAdminData();
			else adminSecret.clear(); // stale/invalid — force re-entry
		}
		probing = false;
	}

	onMount(initGate);

	async function submitSecret() {
		if (!secretInput.trim()) return;
		gateError = null;
		adminSecret.set(secretInput);
		secretInput = '';
		const ok = await probeAuth();
		if (ok) {
			authorized = true;
			await loadAdminData();
		} else {
			adminSecret.clear();
			gateError = lastProbeStatus === 429 ? m.error_too_many_requests() : 'Wrong secret. Try again.';
		}
	}

	function lock() {
		adminSecret.clear();
		authorized = false;
		stats = null;
	}

	// ---- Data reset (destructive) ----
	let resetting = $state(false);
	let resetDone = $state(false);
	async function resetData() {
		if (resetting) return;
		if (!confirm('Wipe ALL theses, arguments and votes on this instance? This cannot be undone.')) return;
		if (!confirm('Really? Everything will be deleted.')) return;
		resetting = true;
		try {
			const res = await fetch('/api/admin/reset', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-confirm-reset': 'yes', ...adminSecret.headers() },
				body: JSON.stringify({ keep_settings: true })
			});
			if (res.status === 403 || res.status === 401) {
				authError = true;
				authorized = false;
				return;
			}
			if (res.ok) {
				resetDone = true;
				setTimeout(() => { resetDone = false; }, 3000);
			}
		} finally {
			resetting = false;
		}
	}

	async function saveBanner() {
		const res = await fetch('/api/admin/banner', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', ...adminSecret.headers() },
			body: JSON.stringify({ text: bannerText })
		});
		if (res.status === 403 || res.status === 401) {
			authError = true;
			authorized = false;
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

{#if !authorized}
	<section class="admin-gate">
		<div class="gate-card">
			<h1 class="gate-title">Admin</h1>
			<p class="gate-lead">
				Enter the operator secret to unlock this instance's admin tools.
				Nothing else on this page is shown until you're in.
			</p>
			{#if probing}
				<p class="gate-hint">Checking…</p>
			{:else}
				<form class="gate-form" onsubmit={(e) => { e.preventDefault(); submitSecret(); }}>
					<!-- svelte-ignore a11y_autofocus — this is a single-purpose gate; autofocus is the expected UX -->
					<input
						type="password"
						bind:value={secretInput}
						placeholder="Admin secret"
						class="gate-input"
						autocomplete="current-password"
						autofocus
					/>
					<button class="btn btn-primary" type="submit" disabled={!secretInput.trim()}>Unlock</button>
				</form>
				{#if gateError}<p class="gate-error">{gateError}</p>{/if}
			{/if}
		</div>
	</section>
{:else}
<section class="stack-lg">
	<h1 class="page-title">Admin</h1>

	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">Operator access</h3>
			<p class="setting-hint">
				Admin actions (banner, stats, logs, archiving) are unlocked for this browser session.
			</p>
		</div>
		<div class="secret-form">
			<span class="unlocked-badge">Unlocked</span>
			<button class="btn btn-sm" type="button" onclick={lock}>Lock</button>
		</div>
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

	<div class="card stack danger-card">
		<div class="setting-group">
			<h3 class="setting-label danger-label">Reset all data</h3>
			<p class="setting-hint">
				Wipes every thesis, argument and vote on this instance. Settings and the
				banner are kept. For per-iteration business use — cannot be undone.
			</p>
		</div>
		<div class="danger-actions">
			<button class="btn btn-danger" onclick={resetData} disabled={resetting}>
				{resetting ? 'Resetting…' : 'Reset all data'}
			</button>
			{#if resetDone}<span class="saved-hint">Done — data wiped.</span>{/if}
		</div>
	</div>
</section>
{/if}

<style>
	.page-title {
		font-family: var(--font-serif);
		font-size: 1.5rem;
		font-weight: 600;
	}

	/* ---- Gate (unauthorized state) ---- */
	.admin-gate {
		min-height: 60vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.gate-card {
		width: 100%;
		max-width: 380px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		padding: 2rem 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.gate-title {
		font-family: var(--font-serif);
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0;
	}
	.gate-lead {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		line-height: 1.5;
		margin: 0;
	}
	.gate-hint {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		margin: 0;
	}
	.gate-form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}
	.gate-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: 16px;
		background: var(--color-bg);
		color: var(--color-text);
	}
	.gate-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-reject);
		font-weight: 500;
	}
	.unlocked-badge {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		background: var(--color-support-bg, rgba(0, 128, 0, 0.1));
		color: var(--color-support, #2c8a2c);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.secret-form {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
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

	.danger-card {
		border-color: var(--color-reject);
	}

	.danger-label {
		color: var(--color-reject);
	}

	.danger-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.btn-danger {
		background: var(--color-reject);
		border-color: var(--color-reject);
		color: #fff;
	}

	.btn-danger:hover:not(:disabled) {
		filter: brightness(0.92);
	}

	.btn-danger:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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
