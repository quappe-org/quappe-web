<script lang="ts">
	import type { Thesis, Category } from '$lib/models/types';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { categoriesStore } from '$lib/stores/categories.svelte';
	import { getUserId } from '$lib/stores/user';
	import { m } from '$lib/paraglide/messages';
	import { autogrow } from '$lib/actions/autogrow';

	interface Props {
		oncreated: (thesis: Thesis) => void;
		onclose: () => void;
		suggestedCategories: Category[];
		suggestedForThesis: { id: string; currentCategories: Category[] } | null;
		onapplysuggested: () => void;
		ondismisssuggested: () => void;
	}

	let {
		oncreated,
		onclose,
		suggestedCategories = $bindable<Category[]>([]),
		suggestedForThesis = $bindable<{ id: string; currentCategories: Category[] } | null>(null),
		onapplysuggested,
		ondismisssuggested
	}: Props = $props();

	let title = $state('');
	let description = $state('');
	let selectedCategories = $state<Category[]>([]);
	let submitting = $state(false);
	let createError = $state<string | null>(null);

	let showVariants = $state(false);
	let descriptionSimple = $state('');
	let descriptionDense = $state('');
	let drafting = $state(false);
	let draftError = $state<string | null>(null);

	let similarExisting = $state<Thesis[]>([]);
	let similarLoading = $state(false);
	let similarTimer: ReturnType<typeof setTimeout> | null = null;
	let similarSeq = 0;

	async function draftVariants() {
		if (!title.trim() || !description.trim()) return;
		drafting = true;
		draftError = null;
		try {
			const [simpleRes, denseRes] = await Promise.all([
				fetch('/api/theses/draft-variant', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: title.trim(), description: description.trim(), variant: 'simple' })
				}),
				fetch('/api/theses/draft-variant', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: title.trim(), description: description.trim(), variant: 'dense' })
				})
			]);
			if (simpleRes.ok) {
				const d = (await simpleRes.json()) as { description: string };
				descriptionSimple = d.description;
			}
			if (denseRes.ok) {
				const d = (await denseRes.json()) as { description: string };
				descriptionDense = d.description;
			}
			// The draft endpoint 503s when the local LLM (Ollama) is down. Without
			// this the button just spins-then-nothing, leaving the user guessing.
			if (!simpleRes.ok && !denseRes.ok) {
				draftError = m.home_create_variants_error();
			}
		} catch {
			draftError = m.home_create_variants_error();
		} finally {
			drafting = false;
		}
	}

	export function onFormTyping() {
		if (similarTimer) clearTimeout(similarTimer);
		const combined = `${title.trim()} ${description.trim()}`.trim();
		if (combined.length < 8) {
			similarExisting = [];
			similarLoading = false;
			return;
		}
		similarLoading = true;
		const mySeq = ++similarSeq;
		similarTimer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/theses/similar?q=${encodeURIComponent(combined)}`);
				if (!res.ok) return;
				const payload = await res.json();
				if (mySeq !== similarSeq) return;
				similarExisting = (payload.results ?? []).slice(0, 3);
			} finally {
				if (mySeq === similarSeq) similarLoading = false;
			}
		}, 400);
	}

	function toggleCategory(cat: Category) {
		if (selectedCategories.includes(cat)) {
			selectedCategories = selectedCategories.filter((c) => c !== cat);
		} else {
			selectedCategories = [...selectedCategories, cat];
		}
	}

	async function createThesis() {
		if (!title.trim() || !description.trim()) return;
		if (!budgetStore.canCreateThesis()) {
			createError = m.error_thesis_limit_reached();
			return;
		}
		budgetStore.spendThesis();
		submitting = true;
		createError = null;
		const payloadCategories = selectedCategories.length > 0 ? selectedCategories : ['other'];
		try {
			const res = await fetch('/api/theses', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: title.trim(),
					description: description.trim(),
					categories: payloadCategories,
					description_simple: descriptionSimple.trim() || undefined,
					description_dense: descriptionDense.trim() || undefined,
					author_id: getUserId()
				})
			});
			if (!res.ok) {
				budgetStore.refundThesis();
				if (res.status === 429) {
					createError = m.error_too_many_requests();
				} else if (res.status === 413) {
					createError = m.error_text_too_long();
				} else if (res.status === 400) {
					const body = await res.json().catch(() => ({}));
					createError = body?.error ?? m.error_invalid_input();
				} else {
					createError = m.error_server_generic({ status: res.status });
				}
				return;
			}
			const responseData = await res.json();
			const suggested: Category[] = responseData.suggested_categories ?? [];
			const currentCats = [...selectedCategories];

			let finalThesis: Thesis = responseData;
			const suggestionIsFallback = suggested.length === 1 && suggested[0] === 'other';
			if (currentCats.length === 0 && suggested.length > 0 && !suggestionIsFallback) {
				try {
					const putRes = await fetch(`/api/theses/${responseData.id}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ categories: suggested })
					});
					if (putRes.ok) finalThesis = await putRes.json();
				} catch {
					// fall through with uncategorized thesis
				}
			}

			oncreated(finalThesis);

			if (currentCats.length > 0) {
				const novel = suggested.filter((c) => !currentCats.includes(c));
				if (novel.length > 0) {
					suggestedCategories = novel;
					suggestedForThesis = { id: finalThesis.id, currentCategories: currentCats };
				} else {
					suggestedCategories = [];
					suggestedForThesis = null;
				}
			} else {
				suggestedCategories = [];
				suggestedForThesis = null;
			}

			title = '';
			description = '';
			selectedCategories = [];
			similarExisting = [];
			descriptionSimple = '';
			descriptionDense = '';
			showVariants = false;
			onclose();
		} catch {
			budgetStore.refundThesis();
			createError = m.error_server_generic({ status: 0 });
		} finally {
			submitting = false;
		}
	}

	function handleClose() {
		similarExisting = [];
		createError = null;
		onclose();
	}
</script>

<form class="card create-form" onsubmit={(e) => { e.preventDefault(); createThesis(); }}>
	<div class="form-header">
		<h2 class="form-title">{m.home_create_title()}</h2>
		<button
			type="button"
			class="form-close"
			aria-label={m.home_create_close_aria()}
			title={m.home_create_close_aria()}
			onclick={handleClose}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
		</button>
	</div>

	<div class="form-group">
		<div class="label-row">
			<label for="thesis-title">{m.home_create_title_label()}</label>
			<span class="char-counter" class:near-limit={title.length > 160}>{title.length}/200</span>
		</div>
		<!-- svelte-ignore a11y_autofocus -->
		<input id="thesis-title" type="text" bind:value={title} oninput={onFormTyping} placeholder={m.home_create_title_placeholder()} maxlength="200" required autofocus />
	</div>

	{#if similarLoading || similarExisting.length > 0}
		<div class="similar-existing">
			<div class="similar-head">
				<span class="similar-label">{m.home_create_similar_label()}</span>
				{#if similarLoading}
					<span class="search-spinner" aria-label={m.home_search_searching_aria()}></span>
				{/if}
			</div>
			{#if similarExisting.length > 0}
				<ul class="similar-list">
					{#each similarExisting as ex (ex.id)}
						<li>
							<a class="similar-link" href="/thesis/{ex.id}" target="_blank" rel="noopener">
								<span class="similar-thesis-title">{ex.title}</span>
								<span class="similar-cats">
									{#each ex.categories.slice(0, 3) as cat}
										<span class="similar-cat">{cat}</span>
									{/each}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else if !similarLoading}
				<p class="similar-empty">{m.home_create_similar_empty()}</p>
			{/if}
		</div>
	{/if}

	<div class="form-body">
		<div class="form-group">
			<div class="label-row">
				<label for="thesis-desc">{m.home_create_desc_label()}</label>
				<span class="char-counter" class:near-limit={description.length > 1700}>{description.length}/2000</span>
			</div>
			<textarea id="thesis-desc" class="desc-main" use:autogrow bind:value={description} oninput={onFormTyping} placeholder={m.home_create_desc_placeholder()} maxlength="2000" required></textarea>
		</div>

		<div class="form-group">
			<label for="thesis-categories">
				{m.home_create_categories_label()}
				<span class="hint-inline">{m.home_create_categories_hint()}</span>
			</label>
			<div class="category-grid" id="thesis-categories">
				{#each categoriesStore.list as cat}
					<button
						type="button"
						class="tag category-btn"
						class:selected={selectedCategories.includes(cat)}
						onclick={() => toggleCategory(cat)}
					>{cat}</button>
				{/each}
			</div>
		</div>

		<div class="variants-section">
			<button type="button" class="variants-toggle" onclick={() => (showVariants = !showVariants)} aria-expanded={showVariants}>
				<svg class="variants-chevron" class:open={showVariants} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
				{m.home_create_variants_toggle()}
			</button>
			{#if showVariants}
				<p class="variants-hint">{m.home_create_variants_hint()}</p>
				<div class="variant-draft-row">
					<button type="button" class="variant-draft-btn" disabled={drafting || !title.trim() || !description.trim()} onclick={draftVariants}>
						{drafting ? m.home_create_variants_drafting() : m.home_create_variants_draft()}
					</button>
				</div>
				{#if draftError}
					<p class="variant-draft-error" role="alert">{draftError}</p>
				{/if}

				<div class="variant-block">
					<span class="variant-block-title">{m.rephrase_simple()}</span>
					<textarea use:autogrow bind:value={descriptionSimple} placeholder={m.home_create_desc_placeholder()} maxlength="2000"></textarea>
				</div>

				<div class="variant-block">
					<span class="variant-block-title">{m.rephrase_dense()}</span>
					<textarea use:autogrow bind:value={descriptionDense} placeholder={m.home_create_desc_placeholder()} maxlength="2000"></textarea>
				</div>
			{/if}
		</div>
	</div>

	<div class="form-footer">
		{#if createError}
			<p class="create-error" role="alert">{createError}</p>
		{/if}
		<div class="form-actions">
			<button class="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting}>
				{#if submitting}<span class="btn-spinner" aria-hidden="true"></span>{/if}
				{submitting ? m.home_create_submitting() : m.home_create_submit()}
			</button>
			<button class="btn" type="button" onclick={handleClose}>{m.home_create_cancel()}</button>
		</div>
	</div>
</form>

<style>
	.create-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex: 1;
		min-height: 0;
	}

	.form-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* The description is the main writing task — give it real vertical presence
	   so the sheet doesn't feel like a cramped one-line box. autogrow expands it
	   further as the user types past this floor. */
	.desc-main {
		min-height: 11rem;
	}

	/* Sticky footer pins the submit row to the bottom of the sheet's scroll
	   container, so the button stays reachable no matter how long the description
	   grows. Negative margins bleed the background over the sheet's own padding
	   (52rem sheet: 1.5rem/1.6rem; mobile full-screen: 1.2rem). */
	.form-footer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		position: sticky;
		bottom: 0;
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		margin: 0 -1.6rem -1.5rem;
		padding: 0.75rem 1.6rem 0.5rem;
	}

	@media (max-width: 768px) {
		.form-footer {
			margin: 0 -1.2rem -1rem;
			padding-left: 1.2rem;
			padding-right: 1.2rem;
			padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0));
		}
	}

	.form-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.form-title {
		font-size: var(--text-lg);
		font-weight: 600;
		margin: 0;
	}

	.form-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
		border-radius: var(--radius-sm);
		cursor: pointer;
		flex-shrink: 0;
	}

	.form-close:hover {
		background: var(--color-reject-bg);
		border-color: var(--color-reject);
		color: var(--color-reject);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.label-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.char-counter {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--color-text-light);
		flex-shrink: 0;
	}

	.char-counter.near-limit {
		color: var(--color-reject);
		font-weight: 600;
	}

	.form-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn-spinner {
		display: inline-block;
		width: 0.85rem;
		height: 0.85rem;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.category-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.category-btn {
		cursor: pointer;
		border: 1px solid var(--color-border);
		transition: all var(--transition-fast);
	}

	.category-btn.selected {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.variants-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-top: 1px solid var(--color-border);
		padding-top: 0.85rem;
	}

	.variants-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		padding: 0;
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		align-self: flex-start;
	}

	.variants-toggle:hover {
		color: var(--color-text);
	}

	.variants-chevron {
		transition: transform var(--transition-fast);
	}
	.variants-chevron.open {
		transform: rotate(90deg);
	}

	.variants-hint {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		line-height: 1.5;
		margin: 0;
	}

	.variant-block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.variant-draft-row {
		display: flex;
		justify-content: flex-end;
	}

	.variant-block-title {
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.variant-draft-btn {
		font-family: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-primary);
		border: 1px solid var(--color-primary);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.variant-draft-btn:hover:not(:disabled) {
		background: var(--color-primary);
		color: #fff;
	}

	.variant-draft-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.variant-draft-error {
		margin: 0;
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--color-text-muted);
		background: var(--color-bg);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.6rem;
	}

	.create-error {
		margin: 0;
		padding: 0.5rem 0.75rem;
		background: var(--color-reject-bg);
		border: 1px solid var(--color-reject);
		border-radius: var(--radius-md);
		color: var(--color-reject);
		font-size: var(--text-sm);
	}

	.hint-inline {
		font-weight: 400;
		font-size: 0.7rem;
		color: var(--color-text-light);
		margin-left: 0.4rem;
		text-transform: none;
		letter-spacing: 0;
	}

	.similar-existing {
		background: var(--color-bg);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		padding: 0.5rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.similar-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.similar-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.similar-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.similar-link {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--color-text);
		transition: background var(--transition-fast);
	}

	.similar-link:hover {
		background: var(--color-surface);
	}

	.similar-thesis-title {
		font-size: var(--text-sm);
		line-height: 1.4;
		width: 100%;
		/* Two lines then ellipsis — full readability without a wall of text. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.similar-cats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.similar-cat {
		font-size: 0.65rem;
		font-family: var(--font-mono);
		color: var(--color-text-light);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		padding: 0.05rem 0.4rem;
		text-transform: capitalize;
	}

	.similar-empty {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		margin: 0;
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
