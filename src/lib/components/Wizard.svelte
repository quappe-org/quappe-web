<script lang="ts">
	import { onboardingStore } from '$lib/stores/onboarding.svelte';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { themeStore, type Theme } from '$lib/stores/theme.svelte';
	import { getLocale, setLocale, locales, type Locale } from '$lib/paraglide/runtime';
	import { COMPLEXITY_MIN, COMPLEXITY_DEFAULTS, COMPLEXITY_MAX } from '$lib/models/types';
	import { m } from '$lib/paraglide/messages';

	let step = $state(0);
	const lastStep = 3;

	const localeLabels: Record<Locale, string> = {
		en: 'English',
		de: 'Deutsch',
		fr: 'Français',
		es: 'Español'
	};

	// Complexity presets — map to the existing settings shape.
	const depthPresets = [
		{ id: 'simple', settings: COMPLEXITY_MIN, label: () => m.wizard_depth_simple() },
		{ id: 'balanced', settings: COMPLEXITY_DEFAULTS, label: () => m.wizard_depth_balanced() },
		{ id: 'deep', settings: COMPLEXITY_MAX, label: () => m.wizard_depth_deep() }
	] as const;
	let activeDepth = $state<'simple' | 'balanced' | 'deep'>('balanced');
	function pickDepth(p: (typeof depthPresets)[number]) {
		activeDepth = p.id;
		complexityStore.set(p.settings);
	}

	const themeOptions: { id: Theme; swatch: string; label: () => string }[] = [
		{ id: 'rainbow', swatch: '#4f46e5', label: () => m.panel_theme_rainbow() },
		{ id: 'pastel', swatch: '#8b7bd9', label: () => m.panel_theme_pastel() },
		{ id: 'classic', swatch: '#705c3b', label: () => m.panel_theme_classic() },
		{ id: 'unicorn', swatch: '#d946ef', label: () => m.panel_theme_unicorn() },
		{ id: 'grayscale', swatch: '#2b2b2b', label: () => m.panel_theme_grayscale() }
	];

	let activeLocale = $derived<Locale>(getLocale());

	function chooseLocale(loc: Locale) {
		if (loc === activeLocale) {
			step = 1;
			return;
		}
		// setLocale reloads (URL-prefix strategy). The wizard re-appears after the
		// reload in the new language (onboarding not yet complete) — acceptable.
		setLocale(loc);
	}

	function next() {
		if (step < lastStep) step += 1;
		else finish();
	}
	function back() {
		if (step > 0) step -= 1;
	}
	function finish() {
		onboardingStore.complete();
	}
	function skip() {
		onboardingStore.complete();
	}
</script>

<div class="wizard-backdrop" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
	<div class="wizard">
		<button class="wizard-skip" onclick={skip}>{m.wizard_skip()}</button>

		{#if step === 0}
			<div class="wizard-step">
				<h2 id="wizard-title" class="wizard-title">{m.wizard_welcome_title()}</h2>
				<p class="wizard-lead">{m.wizard_welcome_lead()}</p>
				<div class="wizard-choices">
					{#each locales as loc}
						<button
							class="wizard-choice"
							class:active={loc === activeLocale}
							onclick={() => chooseLocale(loc)}
						>{localeLabels[loc]}</button>
					{/each}
				</div>
			</div>
		{:else if step === 1}
			<div class="wizard-step">
				<h2 class="wizard-title">{m.wizard_depth_title()}</h2>
				<p class="wizard-lead">{m.wizard_depth_lead()}</p>
				<div class="wizard-choices wizard-choices-col">
					{#each depthPresets as p}
						<button
							class="wizard-choice"
							class:active={activeDepth === p.id}
							onclick={() => pickDepth(p)}
						>{p.label()}</button>
					{/each}
				</div>
			</div>
		{:else if step === 2}
			<div class="wizard-step">
				<h2 class="wizard-title">{m.wizard_theme_title()}</h2>
				<p class="wizard-lead">{m.wizard_theme_lead()}</p>
				<div class="wizard-choices wizard-themes">
					{#each themeOptions as t}
						<button
							class="wizard-choice wizard-theme"
							class:active={themeStore.current === t.id}
							onclick={() => themeStore.set(t.id)}
						>
							<span class="wizard-swatch" style="background: {t.swatch}"></span>
							{t.label()}
						</button>
					{/each}
				</div>
				<p class="wizard-hint">{m.wizard_theme_a11y_hint()}</p>
			</div>
		{:else}
			<div class="wizard-step">
				<h2 class="wizard-title">{m.wizard_how_title()}</h2>
				<ul class="wizard-how">
					<li>{m.wizard_how_1()}</li>
					<li>{m.wizard_how_2()}</li>
					<li>{m.wizard_how_3()}</li>
				</ul>
			</div>
		{/if}

		<div class="wizard-nav">
			<div class="wizard-dots">
				{#each [0, 1, 2, 3] as i}
					<span class="wizard-dot" class:on={i === step}></span>
				{/each}
			</div>
			<div class="wizard-nav-btns">
				{#if step > 0}
					<button class="wizard-btn" onclick={back}>{m.wizard_back()}</button>
				{/if}
				<button class="wizard-btn wizard-btn-primary" onclick={next}>
					{step === lastStep ? m.wizard_finish() : m.wizard_next()}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.wizard-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.35);
		backdrop-filter: blur(3px);
	}

	.wizard {
		position: relative;
		width: 100%;
		max-width: 440px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		padding: 2rem 1.75rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.wizard-skip {
		position: absolute;
		top: 0.85rem;
		right: 1rem;
		background: none;
		border: none;
		font-size: var(--text-xs);
		color: var(--color-text-light);
		cursor: pointer;
	}
	.wizard-skip:hover { color: var(--color-text-muted); }

	.wizard-step {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 200px;
	}

	.wizard-title {
		font-family: var(--font-serif);
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.2;
		margin: 0;
	}

	.wizard-lead {
		color: var(--color-text-muted);
		line-height: 1.55;
		margin: 0;
	}

	.wizard-choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	.wizard-choices-col { flex-direction: column; }
	.wizard-themes { gap: 0.4rem; }

	.wizard-choice {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.9rem;
		font-family: inherit;
		font-size: var(--text-sm);
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}
	.wizard-choice:hover { border-color: var(--color-text-muted); }
	.wizard-choice.active {
		border-color: var(--color-primary);
		background: var(--color-primary-bg);
		color: var(--color-primary);
		font-weight: 600;
	}

	.wizard-swatch {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
	}

	.wizard-hint {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		margin: 0.2rem 0 0;
	}

	.wizard-how {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		color: var(--color-text);
		line-height: 1.5;
	}

	.wizard-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-top: 1px solid var(--color-border);
		padding-top: 1rem;
	}

	.wizard-dots {
		display: flex;
		gap: 0.35rem;
	}
	.wizard-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-border);
	}
	.wizard-dot.on { background: var(--color-primary); }

	.wizard-nav-btns {
		display: flex;
		gap: 0.5rem;
	}

	.wizard-btn {
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
		transition: background var(--transition-fast), border-color var(--transition-fast);
	}
	.wizard-btn:hover { background: var(--color-bg); }
	.wizard-btn-primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
	}
	.wizard-btn-primary:hover {
		background: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
	}
</style>
