// API response contract types that aren't part of the core domain model.
// In the split architecture, quappe-web is a pure client of the quappe-service
// API. These mirror the shapes the service returns; keep them in sync with the
// service's OpenAPI spec (the contract). No runtime code — types only.

export interface ActivityDay {
	date: string;
	support: number;
	reject: number;
	neutral: number;
	creates: number;
	count: number;
}

export interface CategoryPulse {
	name: string;
	thesis_count: number;
	argument_count: number;
	avg_support_ratio: number;
}

export interface PulseStats {
	total_theses: number;
	total_arguments: number;
	hot_theses: { id: string; title: string; heat: number; arguments: number }[];
	complex_theses: { id: string; title: string; arguments: number }[];
	driving_categories: CategoryPulse[];
	recent_week: { new_theses: number; new_arguments: number };
}

export interface PulseBody {
	text: string | null;
	stats: PulseStats;
	generated_at: string;
	llm: { ok: boolean; model?: string | null; duration_ms?: number; error?: string; hint?: string };
}

// Admin log viewer (data comes from GET /api/admin/logs). Types only.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'store' | 'api' | 'lifecycle' | 'cache' | 'seed' | 'system' | 'llm';
export interface LogEntry {
	seq: number;
	ts: number;
	level: LogLevel;
	source: LogSource;
	message: string;
	meta?: Record<string, unknown>;
}
