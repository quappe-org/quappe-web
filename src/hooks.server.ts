// quappe-web is a pure client of the quappe-service API. The only server-side
// concern here is locale resolution for SSR of the localized pages — all data
// (and identity) comes from the service over /api. No DB, no embeddings, no
// background jobs live in the web app.

import type { Handle } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';

export const handle: Handle = async ({ event, resolve }) => {
	return paraglideMiddleware(event.request, async ({ locale }) => {
		event.locals.locale = locale;
		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
		});
	});
};
