import type { PageLoad } from './$types';
import type { ActivityDay } from '$lib/models/contract';

// Only the fast activity graph loads up-front. The pulse report bundles an LLM
// call that can take seconds on a cold 24h cache — fetching it here would hang
// navigation, so the page fetches it client-side (see +page.svelte) and shows a
// spinner meanwhile. A warm cache hit still returns near-instantly.
export const load: PageLoad = async ({ fetch }) => {
	const activityRes = await fetch('/api/activity');
	const activity: ActivityDay[] = activityRes.ok ? await activityRes.json() : [];
	return { activity };
};
