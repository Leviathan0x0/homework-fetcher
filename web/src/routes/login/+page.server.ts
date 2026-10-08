import { ApiError, errorMessage, login } from '$lib/api';
import { homeRouteFor, setSessionCookie } from '$lib/server/session';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	// Already signed in: nothing to do here.
	const { session } = await parent();
	if (session.authenticated && session.user) {
		redirect(302, homeRouteFor(session.user));
	}
	return {};
};

/**
 * `POST /login`
 *
 * A form action rather than a `fetch`, so the browser follows the `Set-Cookie` without any
 * proxying of response headers and a failed login re-renders the form with the message
 * still in place.
 *
 * The backend decides whether these credentials are valid. This action only decides what to
 * do with the answer, and the landing page comes from the account the backend returned --
 * never from anything derived here.
 */
export const actions: Actions = {
	default: async ({ request, cookies, fetch, url }) => {
		const form = await request.formData();
		const studentId = String(form.get('studentId') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!studentId || !password) {
			return fail(400, {
				studentId,
				error: 'Enter both your school ID and your password.'
			});
		}

		let account;
		try {
			const result = await login(studentId, password, { fetch });
			account = result.user;
			if (!result.sessionCookie) {
				// The login succeeded but no session came back. Showing the dashboard would be
				// a lie; saying so is honest.
				return fail(502, {
					studentId,
					error: 'Signed in, but the session cookie did not arrive. Please try again.'
				});
			}
			setSessionCookie(cookies, result.sessionCookie, url);
		} catch (failure) {
			const apiError = failure instanceof ApiError ? failure : null;
			// A 401 is the expected answer to a wrong password, and the backend's message is
			// deliberately identical for a wrong password and an unknown ID. Showing it is
			// correct; inventing a more specific one here would defeat that.
			return fail(apiError?.status && apiError.status !== 401 ? apiError.status : 401, {
				studentId,
				error: errorMessage(failure, 'Could not sign in. Please try again.')
			});
		}

		// `next` is honoured only for a path inside this app. An absolute URL, or a
		// protocol-relative one, would turn the login form into an open redirect.
		//
		// The backslash matters as much as the double slash: browsers normalise `\` to `/`
		// in a special-scheme URL, so `/\evil.example` reaches evil.example while passing a
		// check that only looks for `//`.
		const next = url.searchParams.get('next');
		const destination =
			next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
				? next
				: homeRouteFor(account);
		redirect(302, destination);
	}
};