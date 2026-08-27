<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ComplexitySettings } from '$lib/models/types';
	import { complexityStore } from '$lib/stores/complexity.svelte';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { uiIntents } from '$lib/stores/ui.svelte';
	import { forkFeedStore } from '$lib/stores/fork-feed.svelte';
	import { updatesStore } from '$lib/stores/updates.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { invertStore } from '$lib/stores/invert.svelte';
	import { a11yStore } from '$lib/stores/a11y.svelte';
	import { localeStore } from '$lib/stores/locale.svelte';
	import { bootstrapUserId } from '$lib/stores/user';
	import ComplexitySlider from '$lib/components/ComplexitySlider.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Wizard from '$lib/components/Wizard.svelte';
	import { onboardingStore } from '$lib/stores/onboarding.svelte';
	import { bannerStore } from '$lib/stores/banner.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import LoginGate from '$lib/components/LoginGate.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import '../app.css';

	let { children }: { children: Snippet } = $props();

	let mounted = $state(false);

	// Top-down shell: transient popovers replace the old permanent sidebar.
	let menuOpen = $state(false);      // overflow menu (about/settings)
	let budgetOpen = $state(false);    // budget popover
	let sliderOpen = $state(false);    // complexity popover
	let themeOpen = $state(false);     // theme + a11y popover

	function closeAllPopovers() {
		menuOpen = false;
		budgetOpen = false;
		sliderOpen = false;
		themeOpen = false;
	}

	// Aesthetic themes shown in the theme popover (label + representative swatch).
	const themeOptions: { id: import('$lib/stores/theme.svelte').Theme; label: () => string; swatch: string }[] = [
		{ id: 'rainbow', label: () => m.panel_theme_rainbow(), swatch: '#4f46e5' },
		{ id: 'pastel', label: () => m.panel_theme_pastel(), swatch: '#8b7bd9' },
		{ id: 'classic', label: () => m.panel_theme_classic(), swatch: '#705c3b' },
		{ id: 'unicorn', label: () => m.panel_theme_unicorn(), swatch: '#d946ef' },
		{ id: 'grayscale', label: () => m.panel_theme_grayscale(), swatch: '#2b2b2b' }
	];

	function handleComplexityChange(settings: ComplexitySettings) {
		complexityStore.set(settings);
	}

	let currentPath = $derived(page.url.pathname);

	// Keep the reactive locale mirror in sync with Paraglide on every
	// navigation (URL-prefix strategy changes the locale via pathname).
	$effect(() => {
		currentPath;
		localeStore.refresh();
	});

	// Close any open popover on navigation.
	$effect(() => {
		currentPath;
		closeAllPopovers();
	});

	function isActive(path: string): boolean {
		if (path === '/') return currentPath === '/';
		if (path === '/my') return currentPath === '/my';
		return currentPath.startsWith(path);
	}

	let unreadCount = $derived(updatesStore.unread + forkFeedStore.pending.length);

	async function newThesis() {
		closeAllPopovers();
		uiIntents.requestNewThesis();
		if (currentPath !== '/') await goto('/');
	}

	// ---- Budget ----
	interface BudgetEventLite {
		kind: 'vote' | 'thesis' | 'argument';
		at: string;
		thesis_id: string;
		thesis_title: string;
		vote_type?: string;
		weight?: number;
	}
	interface BudgetBucketLite {
		spent: number;
		limit: number;
		remaining: number;
	}
	interface BudgetLite {
		date: string;
		theses: BudgetBucketLite;
		arguments: BudgetBucketLite;
		weight_points: BudgetBucketLite;
		events: BudgetEventLite[];
	}
	let budgetData = $state<BudgetLite | null>(null);
	let budgetFetchedAt = 0;
	const BUDGET_TTL_MS = 60_000;

	async function ensureBudgetLoaded() {
		if (typeof window === 'undefined') return;
		if (budgetData && Date.now() - budgetFetchedAt < BUDGET_TTL_MS) return;
		try {
			const res = await fetch('/api/budget/today');
			if (res.ok) {
				budgetData = await res.json();
				budgetFetchedAt = Date.now();
				if (budgetData) budgetStore.syncFromServer(budgetData);
			}
		} catch {
			// silent — the /my page has full details anyway
		}
	}

	onMount(() => {
		mounted = true;
		themeStore.init();
		invertStore.init();
		a11yStore.init();
		localeStore.refresh();
		bannerStore.load();
		authStore.refresh();
		bootstrapUserId().then(() => {
			ensureBudgetLoaded();
			updatesStore.refresh();
		});
		const pollId = setInterval(() => updatesStore.refresh(), 60_000);
		return () => clearInterval(pollId);
	});

	function toggleBudget() {
		const next = !budgetOpen;
		closeAllPopovers();
		budgetOpen = next;
		if (budgetOpen) ensureBudgetLoaded();
	}

	function toggleSlider() {
		const next = !sliderOpen;
		closeAllPopovers();
		sliderOpen = next;
	}

	function toggleMenu() {
		const next = !menuOpen;
		closeAllPopovers();
		menuOpen = next;
	}

	function toggleTheme() {
		const next = !themeOpen;
		closeAllPopovers();
		themeOpen = next;
	}

	// Lowest remaining creation bucket → the number shown on the budget pill.
	let budgetPillValue = $derived(
		Math.min(budgetStore.thesesRemaining, budgetStore.argumentsRemaining)
	);

	function fmtTime(iso: string): string {
		try {
			return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
		} catch {
			return iso;
		}
	}

	function eventLabel(e: BudgetEventLite): string {
		if (e.kind === 'thesis') return `+ ${e.thesis_title}`;
		if (e.kind === 'argument') return `+ arg`;
		return `×${e.weight ?? 1} ${e.vote_type} · ${e.thesis_title}`;
	}
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') closeAllPopovers(); }} />

{#if mounted && authStore.loaded && authStore.needsLogin}
	<LoginGate />
{:else}
<div class="app">
	<!-- ROW 0: top navigation bar -->
	<header class="topbar" class:popover-active={menuOpen || budgetOpen || sliderOpen || themeOpen}>
		<div class="topbar-inner">
			<a href="/" class="brand" onclick={closeAllPopovers}>
				<Logo size={26} />
				<span class="brand-name">Quappe</span>
			</a>

			<nav class="topnav" aria-label="Primary">
				<a href="/" class="topnav-item topnav-updates" class:active={isActive('/')}>
					{m.nav_trending()}
					{#if mounted && unreadCount > 0}<span class="nav-badge">{unreadCount}</span>{/if}
				</a>
				<a href="/top" class="topnav-item" class:active={isActive('/top')}>{m.nav_top()}</a>
				<a href="/my" class="topnav-item" class:active={isActive('/my')}>{m.nav_my_theses()}</a>
				<a href="/pulse" class="topnav-item" class:active={isActive('/pulse')}>{m.nav_community_pulse()}</a>
			</nav>

			<!-- Mobile-only top nav: Feed · (centred + bubble) · Mine -->
			<nav class="mobile-topnav" aria-label="Primary">
				<a href="/" class="mobile-topnav-item nav-feed" class:active={isActive('/')} onclick={closeAllPopovers}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
					<span class="mobile-topnav-label">{m.nav_trending()}</span>
					{#if mounted && unreadCount > 0}<span class="mobile-nav-badge">{unreadCount}</span>{/if}
				</a>

				<a href="/my" class="mobile-topnav-item nav-mine" class:active={isActive('/my')} onclick={closeAllPopovers}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
					<span class="mobile-topnav-label">{m.nav_my_theses()}</span>
				</a>
			</nav>

			<!-- Centred + bubble (absolutely centred to the bar; overshoots downward) -->
			<button class="mobile-new-bubble" onclick={newThesis} aria-label={m.nav_new_thesis_hint()}>
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
			</button>

			<div class="actions">
				<button class="action-btn action-new" onclick={newThesis} title={m.nav_new_thesis_hint()}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
					<span class="action-new-label">{m.nav_new_thesis()}</span>
				</button>

				<!-- Complexity -->
				<div class="pop-wrap secondary-action">
					<button class="action-btn icon-only" class:on={sliderOpen} onclick={toggleSlider} title={m.panel_complexity_title()} aria-label={m.panel_complexity_title()} aria-expanded={sliderOpen}>
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
					</button>
					{#if sliderOpen}
						<div class="popover pop-slider">
							<div class="pop-title-row">
								<h3 class="pop-title">{m.panel_complexity_title()}</h3>
								<a href="/about/complexity" class="pop-help" onclick={closeAllPopovers} title={m.nav_about()} aria-label={m.nav_about()}>?</a>
							</div>
							<ComplexitySlider onchange={handleComplexityChange} />
						</div>
					{/if}
				</div>

				<!-- Budget -->
				<div class="pop-wrap secondary-action">
					<button class="action-btn budget-pill" class:on={budgetOpen} onclick={toggleBudget} title={m.panel_budget_title()} aria-expanded={budgetOpen}>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>
						{#if mounted}<span class="budget-pill-num" class:low={budgetPillValue === 0}>{budgetPillValue}</span>{/if}
					</button>
					{#if budgetOpen}
						<div class="popover pop-budget">
							<div class="pop-title-row">
								<h3 class="pop-title">{m.panel_budget_title()}</h3>
								<a href="/about/voting" class="pop-help" onclick={closeAllPopovers} title={m.nav_about()} aria-label={m.nav_about()}>?</a>
							</div>
							<p class="pop-hint">{m.panel_budget_hint()}</p>
							<div class="budget-list">
								<div class="budget-row">
									<span class="budget-label">{m.panel_budget_theses()}</span>
									<span class="budget-bar"><span class="budget-bar-fill" style="width: {(budgetStore.thesesRemaining / budgetStore.thesesLimit) * 100}%"></span></span>
									<span class="budget-count" class:low={budgetStore.thesesRemaining === 0}>{budgetStore.thesesRemaining}/{budgetStore.thesesLimit}</span>
								</div>
								<div class="budget-row">
									<span class="budget-label">{m.panel_budget_arguments()}</span>
									<span class="budget-bar"><span class="budget-bar-fill" style="width: {(budgetStore.argumentsRemaining / budgetStore.argsLimit) * 100}%"></span></span>
									<span class="budget-count" class:low={budgetStore.argumentsRemaining === 0}>{budgetStore.argumentsRemaining}/{budgetStore.argsLimit}</span>
								</div>
								<div class="budget-row">
									<span class="budget-label">{m.panel_budget_weight()}</span>
									<span class="budget-bar"><span class="budget-bar-fill" style="width: {(budgetStore.weightRemaining / budgetStore.weightLimit) * 100}%"></span></span>
									<span class="budget-count" class:low={budgetStore.weightRemaining === 0}>{budgetStore.weightRemaining}/{budgetStore.weightLimit}</span>
								</div>
							</div>
							{#if budgetData && budgetData.events.length > 0}
								<ul class="budget-events">
									{#each budgetData.events.slice(0, 4) as ev}
										<li class="budget-event">
											<time class="budget-event-time">{fmtTime(ev.at)}</time>
											<a class="budget-event-label" href="/thesis/{ev.thesis_id}">{eventLabel(ev)}</a>
										</li>
									{/each}
								</ul>
							{/if}
							<a href="/my#budget" class="pop-link" onclick={closeAllPopovers}>{m.panel_budget_details_link()}</a>
						</div>
					{/if}
				</div>

				<!-- Theme + accessibility -->
				<div class="pop-wrap secondary-action">
					<button class="action-btn icon-only" class:on={themeOpen} onclick={toggleTheme} title={m.panel_theme_title()} aria-label={m.panel_theme_title()} aria-expanded={themeOpen}>
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"></circle><circle cx="17.5" cy="10.5" r="2.5"></circle><circle cx="8.5" cy="7.5" r="2.5"></circle><circle cx="6.5" cy="12.5" r="2.5"></circle><path d="M12 2a10 10 0 0 0 0 20 3 3 0 0 0 3-3 2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-10-11z"></path></svg>
					</button>
					{#if themeOpen}
						<div class="popover pop-theme">
							<h3 class="pop-title">{m.panel_theme_title()}</h3>
							<div class="theme-grid">
								{#each themeOptions as t}
									<button
										class="theme-choice"
										class:active={mounted && themeStore.current === t.id}
										onclick={() => themeStore.set(t.id)}
									>
										<span class="theme-choice-swatch" style="background: {t.swatch}"></span>
										<span class="theme-choice-label">{t.label()}</span>
									</button>
								{/each}
							</div>

							<div class="pop-divider"></div>

							<h3 class="pop-title">{m.panel_a11y_title()}</h3>
							<div class="a11y-list">
								<button class="a11y-toggle" class:on={mounted && invertStore.on} onclick={() => invertStore.toggle()}>
									<span class="a11y-toggle-label">{m.panel_a11y_invert()}</span>
									<span class="a11y-switch" class:on={mounted && invertStore.on}></span>
								</button>
								<button class="a11y-toggle" class:on={mounted && a11yStore.is('calm')} onclick={() => a11yStore.toggle('calm')}>
									<span class="a11y-toggle-label">{m.panel_a11y_calm()}</span>
									<span class="a11y-switch" class:on={mounted && a11yStore.is('calm')}></span>
								</button>
								<button class="a11y-toggle" class:on={mounted && a11yStore.is('contrast')} onclick={() => a11yStore.toggle('contrast')}>
									<span class="a11y-toggle-label">{m.panel_a11y_contrast()}</span>
									<span class="a11y-switch" class:on={mounted && a11yStore.is('contrast')}></span>
								</button>
								<button class="a11y-toggle" class:on={mounted && a11yStore.is('reducedMotion')} onclick={() => a11yStore.toggle('reducedMotion')}>
									<span class="a11y-toggle-label">{m.panel_a11y_motion()}</span>
									<span class="a11y-switch" class:on={mounted && a11yStore.is('reducedMotion')}></span>
								</button>
							</div>
						</div>
					{/if}
				</div>

				<!-- Overflow menu -->
				<div class="pop-wrap">
					<button class="action-btn icon-only" class:on={menuOpen} onclick={toggleMenu} title="Menu" aria-label="Menu" aria-expanded={menuOpen}>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>
					</button>
					{#if menuOpen}
						<div class="popover pop-menu">
							<!-- Secondary nav — Feed/Mine are in topnav; Top/Pulse are "more" -->
							<a href="/top" class="menu-item menu-item-mobile menu-nav" class:active={isActive('/top')} onclick={closeAllPopovers}>{m.nav_top()}</a>
							<a href="/pulse" class="menu-item menu-item-mobile menu-nav" class:active={isActive('/pulse')} onclick={closeAllPopovers}>{m.nav_community_pulse()}</a>
							<div class="menu-divider menu-item-mobile"></div>
							<button type="button" class="menu-item menu-item-mobile" onclick={toggleSlider}>{m.panel_complexity_title()}</button>
							<button type="button" class="menu-item menu-item-mobile" onclick={toggleBudget}>{m.panel_budget_title()}</button>
							<button type="button" class="menu-item menu-item-mobile" onclick={toggleTheme}>{m.panel_theme_title()}</button>
							<div class="menu-divider menu-item-mobile"></div>
							<a href="/about" class="menu-item" class:active={isActive('/about')} onclick={closeAllPopovers}>{m.nav_about()}</a>
							<a href="/settings" class="menu-item" class:active={isActive('/settings')} onclick={closeAllPopovers}>{m.nav_settings()}</a>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</header>

	<!-- Backdrop closes popovers on outside click -->
	{#if menuOpen || budgetOpen || sliderOpen || themeOpen}
		<button class="popover-backdrop" aria-label="Close" onclick={closeAllPopovers}></button>
	{/if}

	<!-- ROW 1+: main content, centred editorial column -->
	<div class="content">
		{#if bannerStore.visible}
			<div class="site-banner" role="status">
				<span class="site-banner-text">{bannerStore.text}</span>
				<button
					type="button"
					class="site-banner-dismiss"
					onclick={() => bannerStore.dismiss()}
					title="Dismiss"
					aria-label="Dismiss banner"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				</button>
			</div>
		{/if}
		<main class="main">
			{@render children()}
		</main>
	</div>
</div>
{/if}

{#if mounted && onboardingStore.open}
	<Wizard />
{/if}

<style>
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* ---- Top bar ---- */
	.topbar {
		position: sticky;
		top: 0;
		z-index: 100;
		background: color-mix(in srgb, var(--color-surface) 88%, transparent);
		backdrop-filter: saturate(1.4) blur(10px);
		-webkit-backdrop-filter: saturate(1.4) blur(10px);
		border-bottom: 1px solid var(--color-border);
	}

	/* Remove backdrop-filter when any popover is open — backdrop-filter creates
	   a new containing block, which breaks position:fixed children (they end up
	   positioned relative to the bar, not the viewport). */
	.topbar.popover-active {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}

	.topbar-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.7rem 1.5rem;
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-lg);
		font-weight: 700;
		color: var(--color-text);
		text-decoration: none;
		letter-spacing: -0.01em;
		flex-shrink: 0;
	}

	.brand:hover {
		color: var(--color-primary);
	}

	/* ---- Primary nav (centre) ---- */
	.topnav {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-right: auto;
	}

	.topnav-item {
		position: relative;
		padding: 0.4rem 0.7rem;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition: color var(--transition-fast), background var(--transition-fast);
		white-space: nowrap;
	}

	.topnav-item:hover {
		color: var(--color-text);
		background: var(--color-bg);
	}

	.topnav-item.active {
		color: var(--color-primary);
		font-weight: 600;
	}

	.topnav-updates {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	/* Update-count badge — shared base for desktop (.nav-badge) and mobile
	   (.mobile-nav-badge); the two differ only in placement + size below. */
	.nav-badge,
	.mobile-nav-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 700;
		border-radius: 999px;
		line-height: 1;
	}

	.nav-badge {
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.3rem;
		font-size: 0.62rem;
		animation: badge-pulse 2s ease-in-out infinite;
	}

	@keyframes badge-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.15); }
	}

	/* ---- Actions (right) ---- */
	.actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		height: 2.1rem;
		padding: 0 0.7rem;
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
	}

	.action-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
	}

	.action-btn.on {
		background: var(--color-primary-bg);
		color: var(--color-primary);
	}

	.action-btn.icon-only {
		width: 2.1rem;
		padding: 0;
	}

	.action-new {
		color: var(--color-on-primary);
		background: var(--color-primary);
		border-color: var(--color-primary);
		font-weight: 600;
	}

	.action-new:hover {
		background: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		color: var(--color-on-primary);
	}

	.budget-pill {
		gap: 0.3rem;
	}

	.budget-pill-num {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.budget-pill-num.low {
		color: var(--color-reject);
	}

	/* ---- Popovers ---- */
	.pop-wrap {
		position: relative;
	}

	.popover-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
		background: transparent;
		border: none;
		cursor: default;
	}

	.popover {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		z-index: 110;
		min-width: 260px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 0.9rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.pop-slider { min-width: 280px; }
	.pop-menu { min-width: 180px; padding: 0.4rem; gap: 0.1rem; }
	.pop-theme { min-width: 240px; }

	.pop-divider {
		height: 1px;
		background: var(--color-border);
		margin: 0.1rem 0;
	}

	/* Theme choices */
	.theme-grid {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.theme-choice {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.5rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: inherit;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	.theme-choice:hover { background: var(--color-bg); color: var(--color-text); }
	.theme-choice.active { color: var(--color-text); font-weight: 600; }

	.theme-choice-swatch {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		border: 1.5px solid var(--color-surface);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
		flex-shrink: 0;
	}
	.theme-choice.active .theme-choice-swatch {
		box-shadow: 0 0 0 2px var(--color-primary);
	}

	/* A11y toggles */
	.a11y-list {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.a11y-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		text-align: left;
		padding: 0.4rem 0.5rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: inherit;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	.a11y-toggle-label {
		flex: 1;
		min-width: 0;
	}
	.a11y-toggle:hover { background: var(--color-bg); color: var(--color-text); }
	.a11y-toggle.on { color: var(--color-text); }

	.a11y-switch {
		position: relative;
		width: 2rem;
		height: 1.1rem;
		border-radius: 999px;
		background: var(--color-border);
		flex-shrink: 0;
		transition: background var(--transition-fast);
	}
	.a11y-switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: calc(1.1rem - 4px);
		height: calc(1.1rem - 4px);
		border-radius: 50%;
		background: white;
		transition: transform var(--transition-fast);
	}
	.a11y-switch.on {
		background: var(--color-primary);
	}
	.a11y-switch.on::after {
		transform: translateX(0.9rem);
	}

	.pop-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	.pop-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.pop-help {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.3rem;
		height: 1.3rem;
		border-radius: 50%;
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-decoration: none;
		flex-shrink: 0;
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	.pop-help:hover {
		background: var(--color-primary-bg);
		color: var(--color-primary);
	}

	.pop-hint {
		font-size: var(--text-xs);
		color: var(--color-text-light);
		margin: 0;
		line-height: 1.4;
	}

	.pop-link {
		font-size: var(--text-xs);
		color: var(--color-primary);
		text-decoration: none;
		align-self: flex-end;
	}
	.pop-link:hover { text-decoration: underline; }

	.menu-item {
		display: block;
		padding: 0.5rem 0.7rem;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-decoration: none;
		border-radius: var(--radius-sm);
		transition: background var(--transition-fast), color var(--transition-fast);
	}
	.menu-item:hover { background: var(--color-bg); color: var(--color-text); }
	.menu-item.active { color: var(--color-primary); font-weight: 600; }

	/* menu-item as a button (mobile popover triggers) resets */
	button.menu-item {
		width: 100%;
		text-align: left;
		font-family: inherit;
		background: transparent;
		border: none;
		cursor: pointer;
	}

	/* Mobile-only overflow-menu entries (hidden on desktop) */
	.menu-item-mobile { display: none; }

	/* Nav entry inside the mobile menu: badge sits inline */
	.menu-nav {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.menu-divider {
		height: 1px;
		background: var(--color-border);
		margin: 0.3rem 0;
	}

	/* ---- Budget list (inside popover) ---- */
	.budget-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.budget-row {
		display: grid;
		grid-template-columns: 72px 1fr 42px;
		align-items: center;
		gap: 0.4rem;
	}

	.budget-label {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.budget-bar {
		height: 6px;
		background: var(--color-bg);
		border-radius: 3px;
		overflow: hidden;
	}

	.budget-bar-fill {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transition: width var(--transition-base);
	}

	.budget-count {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		text-align: right;
	}
	.budget-count.low { color: var(--color-reject); }

	.budget-events {
		list-style: none;
		margin: 0;
		padding: 0.5rem 0 0;
		border-top: 1px dashed var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.budget-event {
		display: grid;
		grid-template-columns: 2.5rem 1fr;
		gap: 0.4rem;
		align-items: baseline;
		font-size: var(--text-xs);
	}

	.budget-event-time {
		font-family: var(--font-mono);
		color: var(--color-text-light);
	}

	.budget-event-label {
		color: var(--color-text);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.budget-event-label:hover { color: var(--color-primary); }

	/* ---- Content wrapper (banner + main) ---- */
	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* ---- Main content: centred editorial column ---- */
	.main {
		flex: 1;
		width: 100%;
		max-width: 1000px;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
		min-width: 0;
	}

	/* ---- Site banner (admin-configurable) ---- */
	.site-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.6rem 1.5rem;
		background: var(--color-primary-bg);
		border-bottom: 1px solid var(--color-primary);
		color: var(--color-primary);
		font-size: var(--text-sm);
		font-weight: 500;
		text-align: center;
		line-height: 1.4;
	}
	.site-banner-text {
		flex: 0 1 auto;
		min-width: 0;
	}
	.site-banner-dismiss {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.7;
		transition: opacity var(--transition-fast), background var(--transition-fast);
	}
	.site-banner-dismiss:hover {
		opacity: 1;
		background: rgba(0, 0, 0, 0.06);
	}

	/* Mobile-only top nav (hidden on desktop) */
	.mobile-topnav {
		display: none;
	}

	/* ---- Responsive ---- */
	@media (max-width: 768px) {
		/* position: relative anchors the absolutely-centred + bubble;
		   overflow: visible lets the bubble overshoot the bar's bottom edge. */
		.topbar-inner {
			padding: 0.3rem 0.85rem;
			gap: 0.5rem;
			position: relative;
			overflow: visible;
		}
		.brand-name { display: none; }
		/* Desktop nav hidden on mobile — replaced by mobile-topnav inline */
		.topnav { display: none; }
		/* Mobile nav — exact thirds, independent of brand/actions widths.
		   The bar is divided into sixths (Fibonacci-friendly): brand sits far
		   left, "..." far right, and the three primary targets land on the
		   1/3 · 1/2 · 2/3 gridlines. Feed and Mine are absolutely positioned on
		   those lines (like the + bubble is on 1/2), so their spacing is exact
		   regardless of how wide the flanking brand/actions happen to be. */
		.brand { flex: 1; }
		.actions { flex: 1; justify-content: flex-end; }
		.mobile-topnav {
			display: block;
		}
		.mobile-topnav-item {
			position: absolute;
			top: 50%;
			transform: translate(-50%, -50%);
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.15rem;
			padding: 0.35rem 0.5rem;
			color: var(--color-text-muted);
			text-decoration: none;
			background: transparent;
			border: none;
			font-family: inherit;
			cursor: pointer;
			transition: color var(--transition-fast);
			z-index: 2;
		}
		/* Feed at 1/3, Mine at 2/3; + bubble is centred on 1/2 (below). */
		.mobile-topnav-item.nav-feed { left: 33.3333%; }
		.mobile-topnav-item.nav-mine { left: 66.6667%; }
		.mobile-topnav-item.active { color: var(--color-primary); }
		.mobile-topnav-label {
			font-size: 0.6rem;
			font-weight: 500;
			white-space: nowrap;
			line-height: 1;
		}
		.mobile-nav-badge {
			position: absolute;
			top: 0.2rem;
			left: calc(50% + 0.4rem);
			min-width: 0.95rem;
			height: 0.95rem;
			padding: 0 0.2rem;
			font-size: 0.55rem;
		}
		/* The + bubble — absolutely centred to the bar, overshoots downward.
		   No label: a pure raised action button, app-style. */
		.mobile-new-bubble {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -30%);
			display: flex;
			align-items: center;
			justify-content: center;
			width: 3.4rem;
			height: 3.4rem;
			border-radius: 50%;
			background: var(--color-primary);
			color: var(--color-on-primary);
			box-shadow: var(--shadow-primary);
			border: none;
			cursor: pointer;
			z-index: 1;
			transition: transform var(--transition-fast), box-shadow var(--transition-fast);
		}
		.mobile-new-bubble:hover,
		.mobile-new-bubble:active {
			transform: translate(-50%, -30%) scale(1.08);
			box-shadow: 0 6px 18px color-mix(in srgb, var(--color-primary) 60%, transparent);
		}

		/* Hide desktop-only elements */
		.secondary-action > .action-btn { display: none; }
		.menu-item-mobile { display: block; }
		.action-new-label { display: none; }
		.action-new { display: none; }
		/* Topbar on mobile: fixed instead of sticky (browser chrome resizes on
		   scroll and breaks sticky); backdrop-filter off (a filtered fixed
		   element becomes a containing block, trapping fixed children);
		   overflow visible so the + bubble can overshoot the bottom edge. */
		.topbar {
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			overflow: visible;
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
			background: var(--color-surface);
		}
		/* Offset the whole content column (banner + main) below the fixed
		   topbar, so the banner isn't hidden behind it. */
		.content { padding-top: 2.9rem; }
		.main { padding: 1.1rem 1rem 2rem; }
		/* Kill backdrop-filter when a popover is open */
		.topbar.popover-active {
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
		/* Dimmed backdrop for mobile popovers */
		.popover-backdrop {
			background: rgba(0, 0, 0, 0.4);
		}
		/* Centred modal cards for slider/theme/budget */
		.popover {
			position: fixed;
			top: 50dvh;
			left: 50dvw;
			right: auto;
			bottom: auto;
			transform: translate(-50%, -50%);
			z-index: 120;
			width: min(92vw, 22rem);
			max-height: 85dvh;
			border-radius: var(--radius-lg);
			border: 1px solid var(--color-border);
			box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
			padding: 1.1rem 1.2rem;
			font-size: var(--text-base, 1rem);
			overflow-y: auto;
			-webkit-overflow-scrolling: touch;
		}
		.popover .pop-title {
			font-size: var(--text-base, 1rem);
		}

		/* Overflow menu → right-anchored full-height drawer */
		.pop-menu {
			position: fixed;
			inset: 0 0 0 auto;
			bottom: 0;
			left: auto;
			right: 0;
			top: 0;
			transform: none;
			width: min(88vw, 20rem);
			max-height: 100dvh;
			height: 100dvh;
			border-radius: 0;
			border: none;
			border-left: 1px solid var(--color-border);
			box-shadow: -8px 0 24px rgba(0, 0, 0, 0.15);
			padding: max(1rem, env(safe-area-inset-top, 0)) 1.2rem env(safe-area-inset-bottom, 0);
			gap: 0.25rem;
			overflow-y: auto;
		}
		.pop-menu .menu-item {
			font-size: var(--text-base, 1rem);
			padding: 0.85rem 0.9rem;
			border-radius: var(--radius-md);
			color: var(--color-text);
		}
		.pop-menu .menu-item:hover,
		.pop-menu .menu-item:active {
			background: var(--color-bg);
		}
		.pop-menu .menu-nav {
			font-weight: 500;
		}
		.pop-menu .menu-item.active {
			color: var(--color-primary);
			font-weight: 600;
		}
		.pop-menu .menu-divider {
			margin: 0.5rem 0;
		}
	}
</style>
