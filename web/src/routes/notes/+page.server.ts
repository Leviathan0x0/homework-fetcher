import { ApiError, deleteNote, getNotes } from '$lib/api';
import { homeRouteFor, requireSession } from '$lib/server/session';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, fetch, parent }) => {
	const session = cookies.get('app_session');
	const cookie = session ? `app_session=${session}` : undefined;
	const user = await requireSession(parent, '/notes');

	// The notes API belongs to a student. A teacher or admin who typed this URL gets the
	// backend's 403, and the right answer to that is their own landing page rather than a
	// 500: the request was refused for a reason the person can act on.
	let notes;
	try {
		notes = await getNotes({ cookie, fetch });
	} catch (failure) {
		if (failure instanceof ApiError && failure.isForbidden) {
			redirect(302, `${homeRouteFor(user)}?denied=student`);
		}
		throw failure;
	}
	return { user, notes };
};

export const actions: Actions = {
	remove: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { error: 'That note could not be identified.' });
		}
		const session = cookies.get('app_session');
		try {
			await deleteNote(id, { cookie: session ? `app_session=${session}` : undefined, fetch });
		} catch {
			// The backend answers 404 for someone else's note rather than 403, so that a
			// caller cannot discover that an id exists somewhere they may not reach. There is
			// nothing useful to say about it, so there is nothing said.
			return fail(404, { error: 'That note no longer exists.' });
		}
		return { ok: true as const, id };
	}
};