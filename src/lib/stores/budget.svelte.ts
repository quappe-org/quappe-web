// Daily budgets — client-side optimistic mirror. The SERVER is the authority
// (src/lib/server/budget.ts enforces every write); this store just gives the
// UI instant feedback and is reconciled via syncFromServer() on load + writes.
//
// Model (Fibonacci-flavoured), reset at local midnight:
//   - theses:        8/day
//   - arguments:     8/day
//   - weight points: 21/day  (base weight-1 votes are FREE; only extra weight costs)

const THESIS_LIMIT = 8;
const ARG_LIMIT = 8;
const WEIGHT_LIMIT = 21;
const STORAGE_KEY = 'quappe_budget';

interface BudgetState {
	weight_remaining: number;
	theses_remaining: number;
	arguments_remaining: number;
	lastReset: string; // ISO date (YYYY-MM-DD)
}

function getToday(): string {
	return new Date().toISOString().split('T')[0];
}

function emptyState(): BudgetState {
	return {
		weight_remaining: WEIGHT_LIMIT,
		theses_remaining: THESIS_LIMIT,
		arguments_remaining: ARG_LIMIT,
		lastReset: getToday()
	};
}

function loadBudget(): BudgetState {
	if (typeof window === 'undefined') return emptyState();
	const stored = localStorage.getItem(STORAGE_KEY);
	if (!stored) return emptyState();
	try {
		const p = JSON.parse(stored) as Partial<BudgetState>;
		if (typeof p.lastReset !== 'string' || p.lastReset !== getToday()) return emptyState();
		return {
			weight_remaining: clamp(p.weight_remaining, WEIGHT_LIMIT),
			theses_remaining: clamp(p.theses_remaining, THESIS_LIMIT),
			arguments_remaining: clamp(p.arguments_remaining, ARG_LIMIT),
			lastReset: p.lastReset
		};
	} catch {
		return emptyState();
	}
}

function clamp(v: unknown, max: number): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) return max;
	return Math.max(0, Math.min(max, v));
}

function saveBudget(state: BudgetState) {
	if (typeof window === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let _budget = $state<BudgetState>(loadBudget());

function ensureToday() {
	if (_budget.lastReset !== getToday()) {
		_budget = emptyState();
		saveBudget(_budget);
	}
}

export const budgetStore = {
	// ---- Vote weight pool (base votes are free) ----
	get weightRemaining() {
		ensureToday();
		return _budget.weight_remaining;
	},
	get weightLimit() {
		return WEIGHT_LIMIT;
	},
	// A vote of `weight` costs (weight - 1) points; base weight-1 is free.
	weightCost(weight: number): number {
		return Math.max(0, weight - 1);
	},
	canAffordWeight(weight: number): boolean {
		ensureToday();
		return _budget.weight_remaining >= this.weightCost(weight);
	},
	spendWeight(weight: number): boolean {
		ensureToday();
		const cost = this.weightCost(weight);
		if (_budget.weight_remaining < cost) return false;
		_budget = { ..._budget, weight_remaining: _budget.weight_remaining - cost };
		saveBudget(_budget);
		return true;
	},
	refundWeight(weight: number): void {
		ensureToday();
		const cost = this.weightCost(weight);
		_budget = {
			..._budget,
			weight_remaining: Math.min(WEIGHT_LIMIT, _budget.weight_remaining + cost)
		};
		saveBudget(_budget);
	},

	// ---- Theses ----
	get thesesRemaining() {
		ensureToday();
		return _budget.theses_remaining;
	},
	get thesesLimit() {
		return THESIS_LIMIT;
	},
	canCreateThesis(): boolean {
		ensureToday();
		return _budget.theses_remaining > 0;
	},
	spendThesis(): boolean {
		ensureToday();
		if (_budget.theses_remaining <= 0) return false;
		_budget = { ..._budget, theses_remaining: _budget.theses_remaining - 1 };
		saveBudget(_budget);
		return true;
	},
	refundThesis(): void {
		ensureToday();
		_budget = {
			..._budget,
			theses_remaining: Math.min(THESIS_LIMIT, _budget.theses_remaining + 1)
		};
		saveBudget(_budget);
	},

	// ---- Arguments ----
	get argumentsRemaining() {
		ensureToday();
		return _budget.arguments_remaining;
	},
	get argsLimit() {
		return ARG_LIMIT;
	},
	canCreateArgument(): boolean {
		ensureToday();
		return _budget.arguments_remaining > 0;
	},
	spendArgument(): boolean {
		ensureToday();
		if (_budget.arguments_remaining <= 0) return false;
		_budget = { ..._budget, arguments_remaining: _budget.arguments_remaining - 1 };
		saveBudget(_budget);
		return true;
	},
	refundArgument(): void {
		ensureToday();
		_budget = {
			..._budget,
			arguments_remaining: Math.min(ARG_LIMIT, _budget.arguments_remaining + 1)
		};
		saveBudget(_budget);
	},

	/**
	 * Reconcile with server-side truth. Values are "spent today" counts.
	 */
	syncFromServer(status: {
		weight_points?: { spent: number };
		theses?: { spent: number };
		arguments?: { spent: number };
	}): void {
		_budget = {
			weight_remaining: Math.max(0, WEIGHT_LIMIT - (status.weight_points?.spent ?? 0)),
			theses_remaining: Math.max(0, THESIS_LIMIT - (status.theses?.spent ?? 0)),
			arguments_remaining: Math.max(0, ARG_LIMIT - (status.arguments?.spent ?? 0)),
			lastReset: getToday()
		};
		saveBudget(_budget);
	}
};
