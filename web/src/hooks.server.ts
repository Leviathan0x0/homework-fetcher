/**
 * Server-side fetch rewriting.
 *
 * ## Why this exists
 *
 * The API is a separate process from this one, but the browser must talk to it *same
 * origin* or the session cookie becomes a cross-site cookie: `SameSite=None; Secure`, a
 * third-party-cookie context, and a CORS preflight on every write. In development the two
 * also run on different ports, which is cross-origin by accident.
 *
 * So the browser's `/api/*` goes through this app's own proxy route, and the *server's*
 * calls go through `handleFetch` here. Both end at the backend, and both end up with the
 * session cookie attached as an ordinary first-party cookie. No CORS configuration is
 * needed anywhere, in development or in production.
 *
 * ## Why `handleFetch` rather than a base URL
 *
 * The obvious alternative is to compute an absolute URL at each call site. That means two
 * code paths -- one for the browser, one for the server -- and the two drift, which is
 * exactly the class of bug that produced the old frontend's duplicated session handling.
 * Rewriting one `fetch` means every caller can just use `/api/...` and be correct in both
 * places, and there is a single place where the backend's address is configured.
 */

import { env } from '$env/dynamic/private';
import type { HandleFetch } from '@sveltejs/kit';

/**
 * Where the Rust backend listens.
 *
 * Read at *runtime*, not build time: `import.meta.env` is baked into the bundle, so a
 * `BACKEND_URL` set after the build would be silently ignored -- which is the kind of
 * failure that only shows up in the deployed environment.
 */
const backendUrl = (env.BACKEND_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');

// The loopback default is the local development backend, so an unset `BACKEND_URL` in
// production means every page 500s against a port nothing is listening on. One line at
// startup is the difference between a five-second diagnosis and an afternoon. Not a throw:
// `npm run build` imports this module to analyse the build, and a build should not need the
// runtime's environment.
if (process.env.NODE_ENV === 'production' && !env.BACKEND_URL) {
	console.warn('[mmss64] BACKEND_URL is not set. Falling back to ' + backendUrl + '.');
}

export const BACKEND_ORIGIN = backendUrl;

/** Whether a request is one of ours to forward. */
function isApiRequest(url: URL): boolean {
	return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

export const handleFetch: HandleFetch = async ({ request, fetch }) => {
	const url = new URL(request.url);

	if (!isApiRequest(url)) {
		return fetch(request);
	}

	// Point at the backend, keeping the path exactly as the caller wrote it -- `/api/*` all
	// the way through, because the backend really does own that prefix (R10's route table
	// registers `/api/auth/*` rather than nesting under `/api`).
	const target = new URL(`${url.pathname}${url.search}`, backendUrl);

	// The response is returned untouched, including its `Set-Cookie`.
	//
	// That is safe here because this path is only reached by the *server*, and the callers
	// that care about the session (`login`, `changePassword`, `completeSetup`) read the
	// cookie off the response themselves and call `event.cookies.set`. Nothing reaches the
	// browser through this hook, so nothing needs rewriting -- and SvelteKit deliberately
	// refuses `set-cookie` via `setHeaders` anyway, which is a useful reminder that this is
	// not the place to do it.
	return fetch(new Request(target, request));
};
import type { Handle, HandleServerError } from '@sveltejs/kit';

/**
 * The root handle.
 *
 * There is nothing to do on the way in or out, and saying so explicitly is better than
 * leaving it implicit: the one piece of cross-cutting behaviour in this app is
 * {@link handleFetch}, and it is a fetch hook rather than a request hook because that is
 * what keeps `/api/*` same-origin for the server without a proxy round trip.
 */
export const handle: Handle = ({ event, resolve }) => resolve(event);

/**
 * Logs what the browser is not allowed to see.
 *
 * SvelteKit replaces the message of anything that is not an `HttpError` with the literal
 * `Internal Error` before it reaches the page, which is exactly right for the browser and
 * useless for whoever has to fix it: without this hook a production 500 leaves no trace at
 * all, and the first symptom is a login page that will not load. One line on stderr naming
 * the cause is the whole difference.
 */
export const handleError: HandleServerError = ({ status, error }) => {
	console.error(`[${status}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	return { message: 'Something went wrong on our side.' };
};
