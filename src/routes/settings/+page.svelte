<script lang="ts">
	import { getUserId } from '$lib/stores/user';
	import { complexityBoundsStore } from '$lib/stores/complexity-bounds.svelte';
	import { getLocale, setLocale, locales, type Locale } from '$lib/paraglide/runtime';
	import { localeStore } from '$lib/stores/locale.svelte';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { onboardingStore } from '$lib/stores/onboarding.svelte';

	let userId = $state('');
	$effect(() => {
		userId = getUserId();
	});

	// Language & theme — mounted guard so SSR doesn't lock in a wrong active state
	let mounted = $state(false);
	onMount(() => { mounted = true; });

	const localeLabels: Record<Locale, string> = {
		en: 'English',
		de: 'Deutsch',
		fr: 'Français',
		es: 'Español'
	};
	let activeLocale = $derived<Locale>(mounted ? getLocale() : 'en');
	function switchLocale(locale: Locale) {
		if (locale === activeLocale) return;
		setLocale(locale);
		localeStore.refresh();
	}

	// Complexity bounds
	function updateMinTheses(e: Event) {
		const v = Number((e.target as HTMLInputElement).value);
		if (!isNaN(v)) complexityBoundsStore.setMin({ max_theses: v });
	}
	function updateMaxTheses(e: Event) {
		const v = Number((e.target as HTMLInputElement).value);
		if (!isNaN(v)) complexityBoundsStore.setMax({ max_theses: v });
	}
	function updateMinArgs(e: Event) {
		const v = Number((e.target as HTMLInputElement).value);
		if (!isNaN(v)) complexityBoundsStore.setMin({ max_arguments: v });
	}
	function updateMaxArgs(e: Event) {
		const v = Number((e.target as HTMLInputElement).value);
		if (!isNaN(v)) complexityBoundsStore.setMax({ max_arguments: v });
	}
</script>

<section class="stack-lg">
	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">{m.panel_language_title()}</h3>
		</div>
		<div class="pill-group" role="group" aria-label={m.panel_language_title()}>
			{#each locales as loc}
				<button
					type="button"
					class="pill-btn"
					class:active={mounted && loc === activeLocale}
					aria-pressed={mounted && loc === activeLocale}
					title={localeLabels[loc]}
					onclick={() => switchLocale(loc)}
				>
					{localeLabels[loc]}
				</button>
			{/each}
		</div>
	</div>

	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">{m.settings_id_title()}</h3>
			<p class="setting-value mono">{userId}</p>
			<p class="setting-hint">{m.settings_id_hint()}</p>
		</div>

		<hr class="divider" />

		<div class="setting-group">
			<h3 class="setting-label">{m.settings_role_title()}</h3>
			<span class="role-badge">{m.settings_role_badge_admin()}</span>
			<p class="setting-hint">{m.settings_role_hint()}</p>
		</div>
	</div>

	<div class="card stack">
		<div class="setting-group">
			<div class="setting-header">
				<h3 class="setting-label">{m.settings_bounds_title()}</h3>
				<button class="btn btn-sm" onclick={() => complexityBoundsStore.reset()}>{m.settings_bounds_reset()}</button>
			</div>
			<p class="setting-hint">{m.settings_bounds_hint()}</p>
		</div>

		<div class="bounds-grid">
			<div class="bound-row">
				<span class="bound-label">{m.settings_bounds_theses_label()}</span>
				<div class="bound-controls">
					<label>
						<span class="tiny">{m.settings_bounds_min()}</span>
						<input
							type="number"
							min={complexityBoundsStore.hardMin.max_theses}
							max={complexityBoundsStore.max.max_theses}
							value={complexityBoundsStore.min.max_theses}
							oninput={updateMinTheses}
						/>
					</label>
					<span class="range-sep">…</span>
					<label>
						<span class="tiny">{m.settings_bounds_max()}</span>
						<input
							type="number"
							min={complexityBoundsStore.min.max_theses}
							max={complexityBoundsStore.hardMax.max_theses}
							value={complexityBoundsStore.max.max_theses}
							oninput={updateMaxTheses}
						/>
					</label>
					<span class="hard-limits mono">{m.settings_bounds_hard_limit({ min: complexityBoundsStore.hardMin.max_theses, max: complexityBoundsStore.hardMax.max_theses })}</span>
				</div>
			</div>

			<div class="bound-row">
				<span class="bound-label">{m.settings_bounds_args_label()}</span>
				<div class="bound-controls">
					<label>
						<span class="tiny">{m.settings_bounds_min()}</span>
						<input
							type="number"
							min={complexityBoundsStore.hardMin.max_arguments}
							max={complexityBoundsStore.max.max_arguments}
							value={complexityBoundsStore.min.max_arguments}
							oninput={updateMinArgs}
						/>
					</label>
					<span class="range-sep">…</span>
					<label>
						<span class="tiny">{m.settings_bounds_max()}</span>
						<input
							type="number"
							min={complexityBoundsStore.min.max_arguments}
							max={complexityBoundsStore.hardMax.max_arguments}
							value={complexityBoundsStore.max.max_arguments}
							oninput={updateMaxArgs}
						/>
					</label>
					<span class="hard-limits mono">{m.settings_bounds_hard_limit({ min: complexityBoundsStore.hardMin.max_arguments, max: complexityBoundsStore.hardMax.max_arguments })}</span>
				</div>
			</div>
		</div>
	</div>

	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">{m.settings_about_title()}</h3>
			<p class="setting-hint">{m.settings_about_hint()}</p>
			<p class="setting-value mono">v{__APP_VERSION__}</p>
		</div>
	</div>

	<div class="card stack">
		<div class="setting-group">
			<h3 class="setting-label">{m.wizard_settings_title()}</h3>
			<p class="setting-hint">{m.wizard_settings_hint()}</p>
		</div>
		<button class="btn btn-sm" style="width: fit-content" onclick={() => onboardingStore.reopen()}>{m.wizard_settings_button()}</button>
	</div>
</section>

<style>
	.setting-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.setting-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.setting-label {
		font-size: var(--text-base);
		font-weight: 600;
	}

	.setting-value {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		background: var(--color-bg);
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		word-break: break-all;
	}

	.mono {
		font-family: var(--font-mono);
	}

	.setting-hint {
		font-size: var(--text-sm);
		color: var(--color-text-light);
		line-height: 1.5;
	}

	.divider {
		border: none;
		border-top: 1px solid var(--color-border);
	}

	.role-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		font-size: var(--text-xs);
		font-weight: 600;
		border-radius: 9999px;
		background: #fef3c7;
		color: #92400e;
		width: fit-content;
	}

	.bounds-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.bound-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		padding: 0.5rem 0;
	}

	.bound-label {
		font-size: var(--text-sm);
		font-weight: 500;
		min-width: 180px;
	}

	.bound-controls {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.bound-controls label {
		display: inline-flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
	}

	.bound-controls input {
		width: 4.5rem;
		padding: 0.25rem 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.tiny {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-light);
	}

	.range-sep {
		color: var(--color-text-light);
	}

	.hard-limits {
		font-size: var(--text-xs);
		color: var(--color-text-light);
	}

	.pill-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.pill-btn {
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		padding: 0.35rem 0.75rem;
		background: var(--color-bg);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.pill-btn:hover:not(.active) {
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.pill-btn.active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
		cursor: default;
	}

	@media (max-width: 480px) {
		.bound-label {
			min-width: 0;
			width: 100%;
		}
		.bound-controls {
			width: 100%;
		}
		.bound-controls input {
			width: 3.5rem;
		}
	}
</style>
