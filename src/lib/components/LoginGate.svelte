<script lang="ts">
	import { authStore } from '$lib/stores/auth.svelte';
	import { m } from '$lib/paraglide/messages';

	let secret = $state('');
	let submitting = $state(false);

	async function submit() {
		if (!secret.trim() || submitting) return;
		submitting = true;
		await authStore.login(secret.trim());
		submitting = false;
		secret = '';
	}
</script>

<div class="login-gate">
	<div class="login-card">
		<h1 class="login-title">{m.login_title()}</h1>
		<p class="login-lead">{m.login_lead()}</p>
		<form onsubmit={(e) => { e.preventDefault(); submit(); }}>
			<input
				type="password"
				bind:value={secret}
				placeholder={m.login_placeholder()}
				class="login-input"
				autocomplete="off"
			/>
			<button class="btn btn-primary" type="submit" disabled={!secret.trim() || submitting}>
				{submitting ? m.login_submitting() : m.login_submit()}
			</button>
		</form>
		{#if authStore.error}
			<p class="login-error">{authStore.error}</p>
		{/if}
	</div>
</div>

<style>
	.login-gate {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--color-bg);
	}

	.login-card {
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

	.login-title {
		font-family: var(--font-serif);
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0;
	}

	.login-lead {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		line-height: 1.5;
		margin: 0;
	}

	.login-card form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}

	.login-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: 16px;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.login-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-reject);
		font-weight: 500;
	}
</style>
