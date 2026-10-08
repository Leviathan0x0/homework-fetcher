import { ApiError, changePassword, errorMessage, logout, updateProfile } from '$lib/api';
import { requireSession, setSessionCookie } from '$lib/server/session';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, fetch, parent }) => {
	const session = cookies.get('app_session');
	const user = await requireSession(parent, '/settings');
	return { user };
};

function context(cookies: { get: (name: string) => string | undefined }) {
	const session = cookies.get('app_session');
	return { cookie: session ? `app_session=${session}` : undefined };
}

export const actions: Actions = {
	/**
	 * The display name.
	 *
	 * The backend enforces the 200-character bound and rejects a blank name, because an
	 * empty name is what the client is asking the user to replace. Both messages are shown
	 * verbatim -- they are written to be read.
	 */
	profile: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const displayName = String(form.get('displayName') ?? '').trim();

		if (!displayName) {
			return fail(400, { section: 'profile', error: 'Your name cannot be empty.' });
		}
		if (displayName.length > 200) {
			return fail(400, { section: 'profile', error: 'That name is longer than 200 characters.' });
		}

		try {
			await updateProfile(displayName, { ...context(cookies), fetch });
		} catch (failure) {
			return fail(statusOf(failure), { section: 'profile', error: errorMessage(failure) });
		}
		return { ok: true as const, section: 'profile', saved: 'profile' };
	},

	/**
	 * The password.
	 *
	 * Two things worth knowing. The current password is required, so a stolen session alone
	 * cannot take an account over. And the backend revokes every session on success,
	 * including this one, then issues a replacement -- so the cookie below is what keeps
	 * this browser signed in.
	 */
	password: async ({ request, cookies, fetch, url }) => {
		const form = await request.formData();
		const currentPassword = String(form.get('currentPassword') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');
		const confirmPassword = String(form.get('confirmPassword') ?? '');

		if (!currentPassword || !newPassword) {
			return fail(400, { section: 'password', error: 'Fill in both password fields.' });
		}
		// Checked here so a mismatch is obvious, rather than producing a confusing "wrong
		// current password" from the backend when the user simply mistyped the new one twice.
		if (newPassword !== confirmPassword) {
			return fail(400, { section: 'password', error: 'The two new passwords do not match.' });
		}
		if (newPassword.length < 8) {
			return fail(400, {
				section: 'password',
				error: 'Your new password must be at least 8 characters.'
			});
		}

		let replacement: string | null;
		try {
			const result = await changePassword(currentPassword, newPassword, {
				...context(cookies),
				fetch
			});
			replacement = result.sessionCookie;
		} catch (failure) {
			// The backend answers a wrong current password with the same generic message it
			// uses for every credential failure, deliberately. Saying more here would be
			// guessing on its behalf.
			return fail(statusOf(failure), { section: 'password', error: passwordError(failure) });
		}

		if (!replacement) {
			// The password changed but the new session did not arrive. Re-using the old cookie
			// would be worse than useless: the backend has already revoked it.
			return fail(502, {
				section: 'password',
				error: 'Your password was changed, but the new session did not arrive. Please sign in again.'
			});
		}

		// The change revoked every session, including this request's. Without the replacement
		// the student would be signed out by their own successful password change.
		setSessionCookie(cookies, replacement, url);
		return { ok: true as const, section: 'password', saved: 'password' };
	},

	signOut: async ({ cookies, fetch }) => {
		try {
			await logout({ ...context(cookies), fetch });
		} catch {
			// Signing out locally even when the server call fails is the right direction: the
			// cookie is cleared either way, and a session the user asked to end should end.
		}
		cookies.delete('app_session', { path: '/' });
		redirect(302, '/login');
	}
};

function statusOf(failure: unknown): number {
	if (failure instanceof ApiError) return failure.status >= 400 && failure.status < 500 ? failure.status : 502;
	return 502;
}

function passwordError(failure: unknown): string {
	if (failure instanceof ApiError && failure.isUnauthenticated) {
		return 'Your session has ended. Please sign in again.';
	}
	// A 4xx here means the *current* password was refused. The backend answers every
	// credential failure with one identical message on purpose -- which happens to be the
	// text it uses for a setup token, so relaying it verbatim puts "That setup link is not
	// valid or has expired" in front of someone changing their password. That is R12's
	// deliberate opacity doing its job, just on the wrong screen; the frontend knows which
	// screen it is, so it picks a sentence that fits this one.
	if (failure instanceof ApiError && failure.isBadRequest) {
		return 'Your current password is not correct.';
	}
	return errorMessage(failure, 'Could not change your password.');
}