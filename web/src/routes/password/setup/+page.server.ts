import { completeSetup, errorMessage } from '$lib/api';
import { setSessionCookie } from '$lib/server/session';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => ({
	// The token arrives either as a query parameter (from a link the office printed) or as
	// a typed field. Both are supported; the query form is only a convenience.
	token: url.searchParams.get('token') ?? ''
});

/**
 * `POST /password/setup`
 *
 * The R12 first-password flow, and the one endpoint in the app that is deliberately
 * unauthenticated -- an account with no password cannot hold a session.
 *
 * What makes it safe is that the setup token *is* the identity verification: 256 bits of
 * CSPRNG, stored only as a digest, single-use and expiring, and only ever issued for an
 * account that has no password yet. There is no way to obtain one from this frontend.
 */
export const actions: Actions = {
	default: async ({ request, cookies, fetch, url }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();
		const newPassword = String(form.get('newPassword') ?? '');
		const confirmPassword = String(form.get('confirmPassword') ?? '');

		if (!token) {
			return fail(400, { error: 'Enter the setup code from the office.' });
		}
		if (newPassword.length < 8) {
			return fail(400, { error: 'Your password must be at least 8 characters.' });
		}
		if (newPassword !== confirmPassword) {
			return fail(400, { error: 'The two passwords do not match.' });
		}

		let sessionCookie: string | null;
		try {
			const result = await completeSetup(token, newPassword, { fetch });
			sessionCookie = result.sessionCookie;
		} catch (failure) {
			// The backend answers every token problem with one identical message, on purpose:
			// this screen must not be usable to learn whether a token exists or has been
			// spent. Its text is shown verbatim so the student sees exactly what the server
			// said.
			return fail(400, { error: errorMessage(failure, 'That setup code is not valid.') });
		}

		if (!sessionCookie) {
			return fail(502, {
				error: 'Your password was set, but the session did not start. Please sign in.'
			});
		}

		setSessionCookie(cookies, sessionCookie, url);
		redirect(302, '/homework');
	}
};