/**
 * One HTTP call to the Rust backend, from anywhere.
 *
 * The whole point of this module is that there is exactly one place that knows how to talk
 * to the API. Everything else -- loads, actions, components, tests -- goes through an
 * endpoint function that calls `request`, so error handling, JSON decoding, cookie
 * forwarding and the "the backend said 401" decision are written once.
 *
 * ## Where requests go
 *
 * Always `/api/...`, in the browser and on the server alike. Two mechanisms make that work
 * and neither is the caller's problem:
 *
 * * in the browser, the route at `src/routes/api/[...path]/+server.ts` proxies to the
 *   backend, so the request is same-origin and the session cookie is first-party;
 * * on the server, `handleFetch` in `src/hooks.server.ts` rewrites it to the backend
 *   directly, which avoids a pointless round trip through this app's own proxy.
 *
 * So there is no base-URL branch here, and no way for the two paths to drift.
 *
 * ## Errors
 *
 * Every non-2xx becomes an {@link ApiError} carrying the backend's own `code`, so callers
 * can branch on `UNAUTHENTICATED` or `FORBIDDEN` without matching on prose. A 2xx with a
 * body the client cannot parse is *also* an `ApiError`, because a proxy that silently
 * returns HTML would otherwise look like a successful empty response.
 */

import type { ApiErrorBody } from './types';

/**
 * A non-2xx from the API, or a 2xx whose body was not the JSON we expected.
 *
 * `code` is the backend's machine-readable code (`UNAUTHENTICATED`, `FORBIDDEN`,
 * `NOT_FOUND`, `BAD_REQUEST`, `INTERNAL`) and is stable. `message` is the backend's
 * user-facing text, safe to display.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
	}

	/** The session is gone or was never there. */
	get isUnauthenticated(): boolean {
		return this.status === 401;
	}

	/** Signed in, but not allowed. */
	get isForbidden(): boolean {
		return this.status === 403;
	}

	get isNotFound(): boolean {
		return this.status === 404;
	}

	/** The request itself was wrong. Showing the backend's message is right for these. */
	get isBadRequest(): boolean {
		return this.status === 400 || this.code === 'BAD_REQUEST';
	}

	/** A body over the limit, or one the server refused to parse. */
	get isRejected(): boolean {
		return this.status === 413 || this.status === 415;
	}

	get isServerError(): boolean {
		return this.status >= 500;
	}
}

export interface RequestOptions {
	method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	body?: unknown;
	/**
	 * The caller's `Cookie` header, forwarded when running on the server.
	 *
	 * This is how a `load` function authenticates without the browser's cookie jar being
	 * involved: SvelteKit hands us the header, we pass it to the backend, and the backend
	 * decides. The frontend never decides who anyone is.
	 */
	cookie?: string;
	/** A `fetch` implementation. Defaults to the global one; injectable for tests. */
	fetch?: typeof globalThis.fetch;
}

/** Builds the API URL for a path. Always relative -- see the module comment. */
export function apiUrl(path: string): string {
	return `/api${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Performs one API request and decodes the JSON body.
 *
 * @throws {ApiError} on any non-2xx, or on a body that is not JSON.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = 'GET', body, cookie, fetch: fetchImpl = globalThis.fetch } = options;

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (cookie) headers.Cookie = cookie;
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	const response = await fetchImpl(apiUrl(path), {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	const text = await response.text();

	if (!response.ok) {
		// The backend answers every error as `{error, code}`. If that is not what arrived
		// -- a proxy error page, a timeout body -- we still want an ApiError rather than a
		// JSON parse failure, because the caller's job is to show something sensible.
		const parsed = safeParse(text);
		throw new ApiError(
			response.status,
			parsed?.code ?? 'UNKNOWN',
			parsed?.error ?? `The server could not be reached (HTTP ${response.status}).`
		);
	}

	if (!text.trim()) return undefined as T;

	try {
		return JSON.parse(text) as T;
	} catch {
		throw new ApiError(
			response.status,
			'BAD_RESPONSE',
			'The server sent a response this app could not read.'
		);
	}
}

function safeParse(text: string): ApiErrorBody | null {
	try {
		const parsed = JSON.parse(text);
		return typeof parsed?.error === 'string' ? (parsed as ApiErrorBody) : null;
	} catch {
		return null;
	}
}

/**
 * The same call, plus one response header.
 *
 * Only the two endpoints that mint a session need this, and what they need is the
 * `Set-Cookie` the backend issued -- the raw `Response` stays inside this module so no
 * caller has to think about headers, status codes or body decoding to get one value.
 */
export async function requestWithCookie<T>(
	path: string,
	options: RequestOptions = {}
): Promise<{ data: T; cookie: string | null }> {
	const { method = 'POST', body, cookie, fetch: fetchImpl = globalThis.fetch } = options;

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (cookie) headers.Cookie = cookie;
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	const response = await fetchImpl(apiUrl(path), {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	const text = await response.text();
	if (!response.ok) {
		const parsed = safeParse(text);
		throw new ApiError(
			response.status,
			parsed?.code ?? 'UNKNOWN',
			parsed?.error ?? `The server could not be reached (HTTP ${response.status}).`
		);
	}

	const data = (text.trim() ? JSON.parse(text) : undefined) as T;
	return { data, cookie: readAppSession(response.headers.get('set-cookie')) };
}

/** The `app_session` value out of a `Set-Cookie` header, or `null`. */
export function readAppSession(header: string | null): string | null {
	if (!header) return null;
	const match = /(?:^|;\s*)app_session=([^;]+)/.exec(header);
	return match?.[1] ?? null;
}

/**
 * Turns any thrown value into text worth showing a person.
 *
 * The backend's own message is used whenever there is one, because it is the only text
 * written to be read. Anything else gets a plain sentence rather than `"[object Object]"`
 * or a leaked stack trace.
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}