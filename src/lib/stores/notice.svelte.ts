// Transient notice store — a single, app-wide "toast"-style message shown in
// the shared Popup (vote-nudge card style) and auto-dismissed after ~1.8s.
//
// Why a global store rather than per-page state: the budget-exhausted message
// must fire from every vote path (thesis, argument, linked-thesis) AND the
// create forms — all mounted in different subtrees. A single store + one
// layout-mounted Popup keeps the "objects behave identically" rule: the same
// exhausted-budget feedback appears the same way no matter where you hit it.

const DISMISS_MS = 1800;

let _message = $state<string | null>(null);
let _timer: ReturnType<typeof setTimeout> | undefined;

function show(message: string) {
	_message = message;
	clearTimeout(_timer);
	_timer = setTimeout(() => {
		_message = null;
	}, DISMISS_MS);
}

export const noticeStore = {
	get message() { return _message; },
	get open() { return _message !== null; },
	show,
	dismiss() {
		clearTimeout(_timer);
		_message = null;
	}
};
