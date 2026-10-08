/**
 * The same-origin `/api` proxy.
 *
 * The two things that matter here are that it cannot be walked out of `/api`, and that a
 * `Set-Cookie` from the backend survives the trip -- without the second, browser-side
 * login is broken while server-side login still works, which is exactly the kind of thing
 * that passes every other test.
 *
 * The handler is called directly rather than through a running server: it is one function
 * with `params`, `request` and `url`, and a test server would only add moving parts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';

/** A stand-in for the Rust backend: records what it was asked and answers as told. */
function upstream(answer: () => Response) {
	return vi.fn(async () => answer());
}

const url = (path: string, search = '') => new URL(`http://localhost:5175/api/${path}${search}`);
const request = (path: string, init: RequestInit = {}) =>
	new Request(`http://localhost:5175/api/${path}`, init);

/** The handler's own event, assembled from the arguments it actually reads. */
function event(paramsPath: string | undefined, req: Request, search = '') {
	return {
		params: { path: paramsPath },
		request: req,
		url: url(paramsPath ?? '', search)
	} as Parameters<typeof GET>[0];
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = upstream(() => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('the /api proxy', () => {
	it('refuses a path that walks out of /api', async () => {
		// SvelteKit decodes the catch-all before the handler sees it, so a request for
		// `/api/%2e%2e%2f%2e%2e%2fmetrics` arrives here as the second entry -- which is
		// exactly what `fetch` would otherwise resolve out of `/api`.
		for (const path of ['../../metrics', '../../ready', 'auth/../../health', '.']) {
			const response = await GET(event(path, request('x')));
			expect(response.status, path).toBe(404);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('relays the API path and query to the backend', async () => {
		await GET(event('homework', request('homework'), '?from=2026-01-01'));
		const target = fetchMock.mock.calls[0][0] as string;
		expect(target).toContain('/api/homework?from=2026-01-01');
	});

	it('relays Set-Cookie, which is the only reason a browser can log in through it', async () => {
		fetchMock = upstream(
			() =>
				new Response('{}', {
					headers: { 'set-cookie': 'app_session=abc123; Path=/; HttpOnly; Max-Age=2592000' }
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await POST(
			event('auth/login', request('auth/login', { method: 'POST' }))
		);
		expect(response.headers.getSetCookie()).toEqual([
			'app_session=abc123; Path=/; HttpOnly; Max-Age=2592000'
		]);
	});

	it('strips a Domain attribute so a backend cookie cannot widen its scope', async () => {
		fetchMock = upstream(
			() =>
				new Response('{}', {
					headers: { 'set-cookie': 'app_session=abc; Path=/; Domain=.evil.example' }
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await POST(event('auth/login', request('auth/login', { method: 'POST' })));
		expect(response.headers.getSetCookie().join()).not.toContain('Domain=');
	});

	it('does not relay a redirect the browser could follow to the backend origin', async () => {
		fetchMock = upstream(
			() => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3001/x' } })
		);
		vi.stubGlobal('fetch', fetchMock);

		const response = await GET(event('auth/me', request('auth/me')));
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBeNull();
		expect(response.body).toBeNull();
	});
});