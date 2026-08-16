// Reverse proxy: quappe-web forwards /api/* to the quappe-service.
//
// Why a proxy instead of direct cross-origin fetches:
// - keeps every existing `fetch('/api/...')` in the UI working unchanged
// - no CORS: the browser only ever talks to the web origin
// - the httpOnly identity cookie stays first-party (same origin) and is
//   forwarded to the service transparently
//
// The service base URL comes from PRIVATE_SERVICE_URL (server-only env), so it
// can point at an internal k8s address in production without leaking to the
// client. Defaults to the local service dev port.

import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const SERVICE_URL = env.PRIVATE_SERVICE_URL ?? 'http://localhost:5273';

const hopByHop = new Set([
	'connection',
	'keep-alive',
	'transfer-encoding',
	'te',
	'trailer',
	'upgrade',
	'proxy-authorization',
	'proxy-authenticate'
]);

async function proxy(event: Parameters<RequestHandler>[0]): Promise<Response> {
	const { request, params, url } = event;
	const path = params.path ?? '';
	const target = `${SERVICE_URL}/api/${path}${url.search}`;

	const headers = new Headers(request.headers);
	headers.delete('host');
	// Preserve the client IP for the service's rate limiter.
	const clientIp = event.getClientAddress();
	if (clientIp) headers.set('x-forwarded-for', clientIp);

	const init: RequestInit = {
		method: request.method,
		headers,
		redirect: 'manual'
	};
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = await request.arrayBuffer();
	}

	const res = await fetch(target, init);

	// Pass the response through, including Set-Cookie so the identity cookie is
	// established on the web origin.
	const outHeaders = new Headers();
	res.headers.forEach((value, key) => {
		if (!hopByHop.has(key.toLowerCase())) outHeaders.set(key, value);
	});

	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers: outHeaders
	});
}

export const GET: RequestHandler = (e) => proxy(e);
export const POST: RequestHandler = (e) => proxy(e);
export const PUT: RequestHandler = (e) => proxy(e);
export const PATCH: RequestHandler = (e) => proxy(e);
export const DELETE: RequestHandler = (e) => proxy(e);
