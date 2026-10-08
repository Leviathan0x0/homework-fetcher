/**
 * The API client's contract with the backend.
 *
 * These are the tests that would catch a real outage: a wrong URL, a dropped cookie, an
 * error body the app cannot read, or a `Set-Cookie` that never makes it back. Everything
 * here runs against an injected `fetch`, so it exercises the real `request` implementation
 * without needing the Rust process to be up.
 *
 * The fixtures are verbatim backend responses captured from a running `mmss-backend`.
 */

import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiUrl, errorMessage, readAppSession, request, requestWithCookie } from './client';
import { login, updateProfile, changePassword, createTeacherHomework } from './endpoints';

/** A `fetch` that records its calls and answers with whatever it is given. */
function stubFetch(response: Response | ((url: string, init?: RequestInit) => Response)) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return typeof response === 'function' ? response(String(url), init) : response;
	});
	return { fetch: impl as unknown as typeof globalThis.fetch, calls };
}

/** A backend-shaped error response. */
function errorResponse(status: number, code: string, error: string): Response {
	return new Response(JSON.stringify({ error, code }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
		...init
	});
}

describe('apiUrl', () => {
	it('always builds a same-origin path, so the server and browser agree', () => {
		// The whole no-CORS design rests on this: there is no absolute-URL branch to drift.
		expect(apiUrl('/auth/login')).toBe('/api/auth/login');
		expect(apiUrl('auth/login')).toBe('/api/auth/login');
	});
});

describe('request', () => {
	it('sends Accept and decodes the body', async () => {
		const { fetch, calls } = stubFetch(jsonResponse({ ok: true }));
		const result = await request<{ ok: boolean }>('/health', { fetch });
		expect(result).toEqual({ ok: true });
		expect(calls[0].init?.headers).toMatchObject({ Accept: 'application/json' });
	});

	it('forwards the caller cookie, which is how a load function authenticates', async () => {
		const { fetch, calls } = stubFetch(jsonResponse({}));
		await request('/homework', { fetch, cookie: 'app_session=abc' });
		expect(calls[0].init?.headers).toMatchObject({ Cookie: 'app_session=abc' });
	});

	it('omits the Cookie header entirely when there is no session', async () => {
		const { fetch, calls } = stubFetch(jsonResponse({}));
		await request('/homework', { fetch });
		expect((calls[0].init?.headers as Record<string, string>).Cookie).toBeUndefined();
	});

	it('serialises a body and sets the content type', async () => {
		const { fetch, calls } = stubFetch(jsonResponse({}));
		await request('/auth/login', { fetch, method: 'POST', body: { studentId: 'a' } });
		expect(calls[0].init?.method).toBe('POST');
		expect(calls[0].init?.body).toBe('{"studentId":"a"}');
		expect(calls[0].init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
	});

	it('sends no body on a GET', async () => {
		const { fetch, calls } = stubFetch(jsonResponse({}));
		await request('/homework', { fetch });
		expect(calls[0].init?.body).toBeUndefined();
		expect(calls[0].init?.headers).not.toHaveProperty('Content-Type');
	});

	it('throws an ApiError carrying the backend code on a 403', async () => {
		const { fetch } = stubFetch(errorResponse(403, 'FORBIDDEN', 'This resource is for teachers.'));
		const failure = await request('/teacher/homework', { fetch }).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(ApiError);
		expect((failure as ApiError).status).toBe(403);
		expect((failure as ApiError).code).toBe('FORBIDDEN');
		expect((failure as ApiError).message).toBe('This resource is for teachers.');
		expect((failure as ApiError).isForbidden).toBe(true);
		expect((failure as ApiError).isUnauthenticated).toBe(false);
	});

	it('treats a 401 as an ended session', async () => {
		const { fetch } = stubFetch(errorResponse(401, 'UNAUTHENTICATED', 'Not signed in.'));
		const failure = (await request('/homework', { fetch }).catch((e: unknown) => e)) as ApiError;
		expect(failure.isUnauthenticated).toBe(true);
	});

	it('still produces an ApiError when the error body is not JSON', async () => {
		// A proxy 502 page must not look like a successful empty response.
		const { fetch } = stubFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));
		const failure = (await request('/homework', { fetch }).catch((e: unknown) => e)) as ApiError;
		expect(failure).toBeInstanceOf(ApiError);
		expect(failure.status).toBe(502);
		expect(failure.isServerError).toBe(true);
	});

	it('rejects a 200 whose body is not JSON', async () => {
		const { fetch } = stubFetch(new Response('<!doctype html>', { status: 200 }));
		const failure = (await request('/homework', { fetch }).catch((e: unknown) => e)) as ApiError;
		expect(failure).toBeInstanceOf(ApiError);
		expect(failure.code).toBe('BAD_RESPONSE');
	});

	it('accepts an empty 200 body', async () => {
		const { fetch } = stubFetch(new Response('', { status: 200 }));
		await expect(request('/auth/logout', { fetch, method: 'POST' })).resolves.toBeUndefined();
	});
});

describe('readAppSession', () => {
	it('pulls the value out of the backend Set-Cookie', () => {
		// A real header from the Rust backend.
		const header = 'app_session=wLhoQnvoxAn69VuZU34fUYQVmqlRBC3f6E9Hl9UlCtI; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax';
		expect(readAppSession(header)).toBe('wLhoQnvoxAn69VuZU34fUYQVmqlRBC3f6E9Hl9UlCtI');
	});

	it('is null when there is no session cookie', () => {
		expect(readAppSession(null)).toBeNull();
		expect(readAppSession('other=1; Path=/')).toBeNull();
	});

	it('treats a cleared cookie as no session at all', () => {
		// `app_session=; Max-Age=0` is how a backend says "sign out". Reading that as an
		// empty-string token would let the login action believe it had been handed a
		// session, so it reports no cookie instead.
		expect(readAppSession('app_session=; Max-Age=0; Path=/')).toBeNull();
	});
});

describe('requestWithCookie', () => {
	it('returns the decoded body and the session cookie together', async () => {
		const { fetch } = stubFetch(
			jsonResponse(
				{ authenticated: true, user: { studentId: '2026001' } },
				{ headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'app_session=tok; Path=/; HttpOnly' } }
			)
		);
		const { data, cookie } = await requestWithCookie<{ authenticated: boolean }>('/auth/login', { fetch });
		expect(data.authenticated).toBe(true);
		expect(cookie).toBe('tok');
	});

	it('reports a missing cookie rather than pretending there is one', async () => {
		const { fetch } = stubFetch(jsonResponse({ user: {} }));
		const { cookie } = await requestWithCookie('/auth/login', { fetch });
		expect(cookie).toBeNull();
	});

	it('still throws an ApiError for a refused login', async () => {
		const { fetch } = stubFetch(errorResponse(401, 'UNAUTHENTICATED', 'Invalid school ID or password.'));
		await expect(requestWithCookie('/auth/login', { fetch })).rejects.toThrow(ApiError);
	});
});

describe('endpoint shapes', () => {
	it('logs in with the two fields the backend expects', async () => {
		// A real `/api/auth/login` body.
		const body = {
			authenticated: true,
			token: 'wLhoQnvoxAn69VuZU34fUYQVmqlRBC3f6E9Hl9UlCtI',
			user: {
				id: 1,
				studentId: '2026001',
				displayName: 'Aarav Sharma',
				classId: 1,
				section: '9-A',
				role: 'student',
				isAdmin: false,
				isTeacher: false
			}
		};
		const { fetch, calls } = stubFetch(
			jsonResponse(body, {
				headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'app_session=abc; Path=/' }
			})
		);
		const result = await login('2026001', 'student-pw-1234', { fetch });
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			studentId: '2026001',
			password: 'student-pw-1234'
		});
		expect(result.user.section).toBe('9-A');
		expect(result.sessionCookie).toBe('abc');
	});

	it('never puts a password anywhere but the request body', async () => {
		const { fetch, calls } = stubFetch(
			jsonResponse({ user: {} }, { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'app_session=x' } })
		);
		await changePassword('old-secret', 'new-secret', { fetch });
		const serialised = JSON.stringify(calls[0].init);
		// The password belongs in the body and nowhere else: not the URL, not a header.
		expect(calls[0].url).not.toContain('secret');
		expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			currentPassword: 'old-secret',
			newPassword: 'new-secret'
		});
		expect(serialised).toContain('old-secret');
	});

	it('updates only the display name', async () => {
		const { fetch, calls } = stubFetch(jsonResponse({ user: { studentId: '2026001' } }));
		await updateProfile('Aarav S.', { fetch });
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({ displayName: 'Aarav S.' });
		expect(calls[0].init?.method).toBe('PATCH');
	});

	it('sends a new entry with both halves nullable rather than omitting them', async () => {
		const { fetch, calls } = stubFetch(jsonResponse({ id: 1 }));
		await createTeacherHomework(
			{ classId: 1, subjectId: 1, dueDate: '2026-11-02', homework: null, classwork: 'Diagram one' },
			{ fetch }
		);
		// `null` and "absent" are different to the backend: `null` means classwork-only.
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			classId: 1,
			subjectId: 1,
			dueDate: '2026-11-02',
			homework: null,
			classwork: 'Diagram one'
		});
	});
});

describe('errorMessage', () => {
	it('prefers the backend message, which is written to be read', () => {
		expect(errorMessage(new ApiError(400, 'BAD_REQUEST', 'That due date is not valid.'))).toBe(
			'That due date is not valid.'
		);
	});

	it('uses a plain Error message', () => {
		expect(errorMessage(new Error('network down'))).toBe('network down');
	});

	it('falls back rather than printing [object Object]', () => {
		expect(errorMessage({ weird: true }, 'Could not save that.')).toBe('Could not save that.');
		expect(errorMessage(null, 'Could not save that.')).toBe('Could not save that.');
	});
});
