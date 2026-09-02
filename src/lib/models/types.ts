// Core domain types for Quappe

export type VoteType = 'support' | 'reject' | 'neutral';

// Categories are dynamic strings - managed by admin in settings
export type Category = string;

// User-typed hashtag (without leading '#', lowercased). Extracted from body text.
export type Hashtag = string;

export const DEFAULT_CATEGORIES: Category[] = [
	'education',
	'policy',
	'health',
	'family',
	'fairness',
	'environment',
	'economy',
	'technology',
	'culture',
	'other'
];

export type EvidenceType = 'study' | 'authority' | 'logical' | 'experiential';

export interface Meta {
	created_at: string; // ISO timestamp
	updated_at: string; // ISO timestamp
	author_id: string; // anonymous UUID
	location?: string; // coarse-grained: country/region, never precise
}

export interface Vote {
	user_id: string;
	type: VoteType;
	weight: number; // 1 = free, additional weight costs 1 budget per point
	cast_at: string; // ISO timestamp
}

export interface VoteSummary {
	support: number; // sum of weights (not count of voters)
	reject: number;
	neutral: number;
	total: number;
	voters: number; // count of distinct users (not weight)
}

export interface ArgumentAttribute {
	evidence_type: EvidenceType;
	source_url?: string; // link to study/authority
	source_comment?: string; // description of the source
}

// ---- Lifecycle model (thesis-level) ----

export type LifecycleState =
	| 'seedling' // newly created, gathering initial reactions
	| 'discussed' // healthy activity, no clear consensus yet
	| 'contested' // active but polarised (support ~ reject)
	| 'crystallized' // clear majority position + solid arguments
	| 'faded' // activity dropped, no consensus reached
	| 'dormant'; // long-inactive; kept as cold reference

export interface LifecycleInfo {
	state: LifecycleState;
	state_since: string; // ISO timestamp when the thesis entered the current state
	quality_score: number; // 0..1, higher = more valuable to surface
}

export interface Argument {
	id: string;
	thesis_id: string;
	content: string;
	attributes: ArgumentAttribute[];
	votes: Vote[];
	forked_from_id?: string; // argument this was forked from (parallel evolution)
	// If set, this argument IS a thesis linked "as an argument" (companion row
	// for a thesis edge). content is empty; display text is the linked thesis
	// title. Lets a linked thesis be voted like any argument.
	linked_thesis_id?: string;
	// Optional — user-authored arguments start with `undefined`. A nightly
	// backend LLM batch job assigns categories asynchronously.
	categories?: Category[];
	hashtags?: Hashtag[]; // user-typed #tags extracted from content
	meta: Meta;
}

export interface Thesis {
	id: string;
	title: string;
	description: string;
	// Optional author-provided readability registers for the DESCRIPTION. The
	// original description IS the "prose" register. When a register is absent,
	// the view falls back to the original. Authored (or author-approved), never
	// generated at read time — so meaning stays the author's responsibility.
	description_simple?: string;
	description_dense?: string;
	categories: Category[];
	hashtags: Hashtag[]; // user-typed #tags extracted from title+description
	votes: Vote[];
	related_thesis_ids: string[]; // graph edges to other Theses
	archived: boolean; // archived by admin (still visible, but de-emphasized)
	lifecycle: LifecycleInfo;
	lang?: string; // 2-letter ISO code (en|de|fr|es); undefined until LLM detects
	meta: Meta;
}

// A user-authored directed link: a thesis (source) shown "as an argument" on
// another thesis (target). Stanceless — the pro/con/neutral meaning comes from
// the author's own vote on the target, never from the edge. Mirrors the service
// type; kept in sync with quappe-service/src/lib/models/types.ts.
export interface ThesisEdge {
	id: string;
	source_thesis_id: string;
	target_thesis_id: string;
	author_id: string;
	created_at: string;
}

// GET /api/theses/{id}/edges response item: the edge, its loaded source thesis,
// and the companion argument (carries the vote_summary for the linked-thesis tile).
export interface ThesisEdgeHydrated {
	edge: ThesisEdge;
	thesis: Thesis;
	argument?: Argument;
}

// API request/response types

export interface CreateThesisRequest {
	title: string;
	description: string;
	categories: Category[];
	location?: string;
}

export interface CreateArgumentRequest {
	thesis_id: string;
	content: string;
	attributes: ArgumentAttribute[];
	forked_from_id?: string;
}

export interface CastVoteRequest {
	user_id: string;
	type: VoteType;
}

// Complexity slider settings — values are Fibonacci steps (see models/fibonacci.ts).
export interface ComplexitySettings {
	max_theses: number; // Fib: 1..55
	max_arguments: number; // Fib: 1..55
	max_related: number; // Fib: 1..55
}

export const COMPLEXITY_DEFAULTS: ComplexitySettings = {
	max_theses: 21,
	max_arguments: 3,
	max_related: 3
};

export const COMPLEXITY_MIN: ComplexitySettings = {
	max_theses: 1,
	max_arguments: 1,
	max_related: 1
};

export const COMPLEXITY_MAX: ComplexitySettings = {
	max_theses: 55,
	max_arguments: 55,
	max_related: 55
};

// Absolute floor/ceiling that the admin can NOT go below/above
// (protects against nonsense configuration)
export const COMPLEXITY_HARD_MIN: ComplexitySettings = {
	max_theses: 1,
	max_arguments: 1,
	max_related: 1
};

export const COMPLEXITY_HARD_MAX: ComplexitySettings = {
	max_theses: 233,
	max_arguments: 233,
	max_related: 233
};
