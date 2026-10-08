/**
 * The session, as the server understands it.
 *
 * There is exactly one way to find out who the caller is -- `GET /auth/me` -- and every
 * protected page goes through here. The frontend never infers an identity from a cookie, a
 * stored profile or a route name, because every one of those is something a user can edit.
 *
 * That single rule is what makes "no duplicated authorization logic in the frontend" true
 * rather than aspirational: the client *displays* what the backend said, and the backend
 * decides.
 */

import { redirect, type Cookies } from '@sveltejs/kit';
import { ApiError, me, type ApiContext } from '$lib/api';
import type { Account } from '$lib/api/types';

/** The signed-in state a page needs. */
export interface Session {
	authenticated: boolean;
	user: Account | null;
}

/** The name of the cookie the backend sets. Mirrored here only to document it. */
export const SESSION_COOKIE = 'app_session';

/**
 * Resolves the caller's session, or `null` when signed out.
 *
 * Never redirects and never throws for a signed-out caller -- `/auth/me` answers 200 with
 * `authenticated: false` precisely so that "am I signed in?" is a value rather than an
 * exception. A backend failure is *not* swallowed, though: treating an unreachable API as
 * "signed out" would show a login form to a student whose session is perfectly valid.
 */
export async function resolveSession(context: ApiContext): Promise<Session> {
	const response = await me(context);
	return response.authenticated
		? { authenticated: true, user: response.user }
		: { authenticated: false, user: null };
}

/**
 * The signed-in account, or a redirect to the login page.
 *
 * Read from the root layout's resolved session rather than asked for again: every page
 * load already resolved it once, and a second `GET /auth/me` per page is a round trip
 * that buys nothing and is a second place for the answer to disagree with itself.
 *
 * `returnTo` is the path to come back to, so a signed-out student who deep-linked into
 * their feed lands there rather than on a home page they did not ask for.
 */
export async function requireSession(
	parent: () => Promise<{ session: Session }>,
	returnTo?: string
): Promise<Account> {
	const { session } = await parent();

	if (!session.authenticated || !session.user) {
		const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
		redirect(302, target);
	}
	return session.user;
}

/**
 * The landing page for an account, by role.
 *
 * Mirrors the backend's own rule rather than inventing one: an administrator lands on the
 * admin view even though `isTeacher` is also true for them, because `AppShell` in the old
 * app gated on `isAdmin` first and the backend's `is_teacher` flag deliberately includes
 * admins (they can reach the teacher API).
 */
export function homeRouteFor(user: Account | null): string {
	if (!user) return '/login';
	if (user.isAdmin || user.role === 'admin') return '/admin';
	if (user.isTeacher || user.role === 'teacher') return '/teacher';
	return '/homework';
}

/** What a role may navigate to. Presentation only -- the backend enforces the truth. */
export function canUseTeacherArea(user: Account | null): boolean {
	return Boolean(user && (user.isTeacher || user.role === 'teacher'));
}

export function isAdmin(user: Account | null): boolean {
	return Boolean(user && (user.isAdmin || user.role === 'admin'));
}

/**
 * Puts the backend's session cookie on the browser.
 *
 * One place, because three copies is three places to disagree. The backend's own value is
 * used verbatim -- SvelteKit cannot copy its attributes across -- so these must match the
 * backend's defaults: `SESSION_TTL_DAYS` is 30, `COOKIE_SAME_SITE` is `lax`, and `Secure`
 * follows whether this request actually arrived over TLS. A change to any of those on the
 * backend needs the same change here.
 */
export function setSessionCookie(cookies: Cookies, value: string, url: URL): void {
	cookies.set(SESSION_COOKIE, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 30
	});
}

/** Reads a `Set-Cookie` value out of a backend response, for the actions that need it. */
export function readSessionCookie(response: Response): string | null {
	const header = response.headers.get('set-cookie');
	if (!header) return null;
	const match = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(header);
	return match?.[1] ?? null;
}

/** Whether an error means "your session ended", as opposed to "this request failed". */
export function isUnauthenticated(error: unknown): boolean {
	return error instanceof ApiError && error.isUnauthenticated;
}