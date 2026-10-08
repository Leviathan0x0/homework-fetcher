/**
 * A same-origin proxy to the Rust backend.
 *
 * ## Why this exists
 *
 * The session is a cookie, and a cookie on a cross-origin request is a cross-site cookie:
 * `SameSite=None; Secure`, a third-party-cookie context, and a CORS preflight for every
 * mutating call. In development the frontend runs on `:5173` and the API on `:3001`, which
 * is cross-origin by accident.
 *
 * Proxying `/api/*` through SvelteKit makes the browser's request same-origin in both
 * development and production, so the cookie is first-party, no CORS configuration is
 * needed anywhere, and `vercel.json`'s rewrite shape stays exactly as `DEPLOYMENT.md`
 * documents it.
 *
 * ## What it forwards
 *
 * The method, the body, and the `Cookie` header in; the status, the `Content-Type`, and
 * `Set-Cookie` out. Nothing else -- in particular no `Origin`, no `Host`, and no
 * `Authorization`, so the proxy cannot become a way to smuggle one origin's credentials to
 * another.
 *
 * Cookies are rewritten so a `Domain` attribute from the backend cannot widen their scope:
 * the response is served on this origin, so the cookie belongs to this origin.
 */

import { BACKEND_ORIGIN } from '../../../hooks.server';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * Where the Rust backend listens, read at runtime.
 *
 * Runtime rather than build time on purpose: `import.meta.env` is baked into the bundle,
 * so a `BACKEND_URL` supplied at deploy time would be silently ignored -- and would only
 * fail in the deployed environment.
 */
// Same value the server-side rewrite uses, so there is one place to configure it.
const backendUrl = BACKEND_ORIGIN;

/** Request headers worth forwarding. Deliberately a short list. */
const FORWARD_REQUEST_HEADERS = ['accept', 'content-type', 'cookie'];

/** Response headers worth returning. `set-cookie` is the whole point of `login`. */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'set-cookie', 'cache-control'];

const handle: RequestHandler = async ({ params, request, url }) => {
	// SvelteKit decodes the catch-all, so `%2e%2e%2f` arrives as `../` and `fetch` would
	// resolve it out of `/api`. The proxy's job is to reach the API, not the three
	// unauthenticated diagnostic routes mounted beside it.
	if ((params.path ?? '').split('/').some((segment) => segment === '.' || segment === '..')) {
		return new Response(JSON.stringify({ error: 'Not found.', code: 'NOT_FOUND' }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}

	const target = `${backendUrl}/api/${params.path}${url.search}`;

	const headers = new Headers();
	for (const name of FORWARD_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}

	// No body on GET or HEAD: forwarding one makes some servers wait for a body that never
	// arrives, and these routes never read one.
	const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
	const upstream = await fetch(target, {
		method: request.method,
		headers,
		body: hasBody ? await request.arrayBuffer() : undefined,
		redirect: 'manual'
	});

	const responseHeaders = new Headers();
	for (const name of FORWARD_RESPONSE_HEADERS) {
		// `getSetCookie` rather than `get`: the backend sets exactly one cookie today, but
		// `get` comma-joins several into one corrupt header if that ever changes.
		const values = name === 'set-cookie' ? upstream.headers.getSetCookie() : [];
		for (const value of values) {
			responseHeaders.append(name, value.replace(/;\s*Domain=[^;]*/gi, ''));
		}
		if (values.length) continue;
		const value = upstream.headers.get(name);
		if (value) responseHeaders.set(name, value);
	}

	// A 3xx from the backend would try to send the browser to the backend's origin, so
	// anything that is not a plain success becomes a pass-through of the body.
	return new Response(upstream.status >= 300 && upstream.status < 400 ? null : upstream.body, {
		status: upstream.status,
		headers: responseHeaders
	});
};

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;