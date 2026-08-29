function resize(el: HTMLTextAreaElement) {
	el.style.height = 'auto';
	el.style.height = el.scrollHeight + 'px';
}

export function autogrow(el: HTMLTextAreaElement) {
	const onInput = () => resize(el);
	resize(el);
	el.addEventListener('input', onInput);
	return {
		update() { resize(el); },
		destroy() { el.removeEventListener('input', onInput); }
	};
}
