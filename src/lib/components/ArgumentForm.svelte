<script lang="ts">
	import type { Argument } from '$lib/models/types';
	import { budgetStore } from '$lib/stores/budget.svelte';
	import { getUserId } from '$lib/stores/user';
	import { m } from '$lib/paraglide/messages';

	type ArgFormMode = 'new' | 'fork' | 'edit';

	// The form is opened declaratively: the page sets `intent` and mounts us.
	// (An imperative ref was racy — this component is rendered behind {#if},
	// so a ref call fired in the same tick as the mount hit a null ref and the
	// form silently opened in its default 'new' state. Props avoid that.)
	export interface ArgFormIntent {
		mode: ArgFormMode;
		source?: Argument; // the argument being forked or edited
	}

	interface Props {
		thesisId: string;
		intent: ArgFormIntent;
		onsubmitted: (arg: Argument, mode: ArgFormMode) => void;
		oncancel: () => void;
		onneedthesisvote: () => void;
	}

	let { thesisId, intent, onsubmitted, oncancel, onneedthesisvote }: Props = $props();

	let mode = $derived(intent.mode);
	let sourceContent = $derived(intent.mode === 'fork' ? (intent.source?.content ?? null) : null);
	let forkedFromId = $derived(
		intent.mode === 'fork' ? intent.source?.id
		: intent.mode === 'edit' ? intent.source?.forked_from_id
		: undefined
	);
	let editingId = $derived(intent.mode === 'edit' ? intent.source?.id : undefined);

	// The merged fork body (original + "\n\n" + addition) must fit the 800-char
	// argument cap, so the addition's own budget is what's left after the frozen
	// original and the two-char separator. Floored at 1 so maxlength stays valid.
	const ARG_MAX = 800;
	let forkAdditionMax = $derived(Math.max(1, ARG_MAX - (sourceContent?.trim().length ?? 0) - 2));

	// Content is seeded from the intent, then user-editable — EXCEPT for forks:
	// a fork keeps the original verbatim and the user only writes an addition
	// (merged on submit). So in fork mode `content` starts empty and holds only
	// the extension; in new/edit it holds the full editable body as before.
	let content = $state('');
	$effect(() => {
		content = intent.mode === 'edit' ? (intent.source?.content ?? '') : '';
	});

	let submitting = $state(false);
	let error = $state<string | null>(null);

	function cancel() {
		error = null;
		oncancel();
	}

	async function extractError(res: Response): Promise<string> {
		if (res.status === 429) return m.error_too_many_requests();
		if (res.status === 413) return m.error_text_too_long();
		if (res.status === 403) {
			const body = await res.json().catch(() => ({}));
			return body?.error ?? m.error_not_allowed();
		}
		if (res.status === 400) {
			const body = await res.json().catch(() => ({}));
			return body?.error ?? m.error_invalid_input();
		}
		return m.error_server_generic({ status: res.status });
	}

	async function submit() {
		if (!content.trim()) return;
		error = null;

		if (mode === 'edit' && editingId) {
			submitting = true;
			try {
				const res = await fetch(`/api/arguments/${editingId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: content.trim(), user_id: getUserId() })
				});
				if (!res.ok) {
					error = await extractError(res);
					return;
				}
				const updated: Argument = await res.json();
				onsubmitted(updated, 'edit');
				cancel();
			} finally {
				submitting = false;
			}
			return;
		}

		submitting = true;
		if (!budgetStore.canCreateArgument()) {
			error = m.argcol_add_disabled_support();
			submitting = false;
			return;
		}
		budgetStore.spendArgument();
		try {
			// Forks keep the original verbatim and append the user's addition, so
			// the parent text is never lost or silently rewritten. new = plain body.
			const body =
				mode === 'fork' && sourceContent
					? `${sourceContent.trim()}\n\n${content.trim()}`
					: content.trim();
			const res = await fetch('/api/arguments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					thesis_id: thesisId,
					content: body,
					forked_from_id: forkedFromId,
					author_id: getUserId()
				})
			});
			if (!res.ok) {
				budgetStore.refundArgument();
				if (res.status === 403) {
					const body = await res.json().catch(() => ({}));
					if (body?.error?.includes('thesis')) { onneedthesisvote(); error = body.error; return; }
				}
				error = await extractError(res);
				return;
			}
			const newArg: Argument = await res.json();
			onsubmitted(newArg, mode);
			cancel();
		} finally {
			submitting = false;
		}
	}
</script>

<form class="card argument-form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
	<h3 class="form-title">
		{#if mode === 'edit'}{m.argform_title_edit()}{:else if mode === 'fork'}{m.argform_title_fork()}{:else}{m.argform_title_new()}{/if}
	</h3>

	{#if mode === 'fork' && sourceContent}
		<div class="fork-source-wrap">
			<span class="fork-source-label">{m.argform_fork_original_label()}</span>
			<blockquote class="fork-source">{sourceContent}</blockquote>
		</div>
	{/if}

	<div class="form-group">
		{#if mode === 'fork'}
			<div class="label-row">
				<label for="arg-content">{m.argform_fork_addition_label()} <span class="hint-inline">{m.argform_fork_addition_hint()}</span></label>
				<span class="char-counter" class:near-limit={content.length > forkAdditionMax - 120}>{content.length}/{forkAdditionMax}</span>
			</div>
			<textarea id="arg-content" bind:value={content} placeholder={m.argform_fork_addition_placeholder()} maxlength={forkAdditionMax} required></textarea>
		{:else}
			<div class="label-row">
				<label for="arg-content">{m.argform_content_label()} <span class="hint-inline">{m.argform_content_hint()}</span></label>
				<span class="char-counter" class:near-limit={content.length > 680}>{content.length}/800</span>
			</div>
			<textarea id="arg-content" bind:value={content} placeholder={m.argform_content_placeholder()} maxlength="800" required></textarea>
		{/if}
	</div>

	<div class="form-actions">
		<button class="btn btn-primary" type="submit" disabled={submitting || !content.trim()} aria-busy={submitting}>
			{#if submitting}<span class="btn-spinner" aria-hidden="true"></span>{/if}
			{#if submitting}{m.argform_submitting()}{:else if mode === 'edit'}{m.argform_submit_edit()}{:else if mode === 'fork'}{m.argform_submit_fork()}{:else}{m.argform_submit_new()}{/if}
		</button>
		<button class="btn" type="button" onclick={cancel}>{m.argform_cancel()}</button>
	</div>

	{#if error}
		<p class="arg-error" role="alert">{error}</p>
	{/if}
</form>

<style>
	.argument-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.form-title {
		font-size: var(--text-base);
		font-weight: 600;
	}

	.fork-source-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.fork-source-label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-light);
	}

	.fork-source {
		margin: 0;
		padding: 0.6rem 0.8rem;
		border-left: 3px solid var(--color-border);
		background: var(--color-bg);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		font-style: italic;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.hint-inline {
		font-weight: 400;
		color: var(--color-text-light);
		font-size: var(--text-xs);
		margin-left: 0.5rem;
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

	.arg-error {
		margin: 0;
		padding: 0.5rem 0.75rem;
		background: var(--color-reject-bg);
		border: 1px solid var(--color-reject);
		border-radius: var(--radius-md);
		color: var(--color-reject);
		font-size: var(--text-sm);
	}
</style>
