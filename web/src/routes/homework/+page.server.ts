import { ApiError, errorMessage, getHomework, getSubjects, setCompleted, setEntryNote, toFeedRows, type FeedRow } from '$lib/api';
import { homeRouteFor, requireSession } from '$lib/server/session';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * The student's class feed.
 *
 * One call to `/auth/me` for the session and one to `/homework` for the data, both on the
 * server with the caller's cookie forwarded. The old app did this in a `useEffect` after
 * first paint, which meant a blank screen first and a flash of cached rows afterwards.
 */
export const load: PageServerLoad = async ({ cookies, fetch, url, parent }) => {
	const session = cookies.get('app_session');
	const cookie = session ? `app_session=${session}` : undefined;
	const user = await requireSession(parent, '/homework');

	// Subjects and the feed are independent reads. Fetched together because the student is
	// waiting on both, and a subject list that fails should not take the feed down with it.
	// The feed belongs to a student. A teacher or admin who typed this URL gets the
	// backend's 403, and the right answer to that is their own landing page rather than a
	// 500: the request was refused for a reason the person can act on.
	//
	// Subjects and the feed are independent reads, fetched together because the student is
	// waiting on both. A subject list that fails degrades the filter pills, not the page.
	const subjects = getSubjects({ cookie, fetch }).catch(() => []);
	let feed;
	try {
		feed = await getHomework({}, { cookie, fetch });
	} catch (failure) {
		if (failure instanceof ApiError && failure.isForbidden) {
			redirect(302, `${homeRouteFor(user)}?denied=student`);
		}
		throw failure;
	}

	// The server accepts `from`/`to`; the app's own date and subject pills filter in memory
	// (see `lib/api/feed.ts`). These stay for a link that wants a specific window.
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const rows: FeedRow[] = toFeedRows(feed).filter(
		(row) => (!from || row.date >= from) && (!to || row.date <= to)
	);

	return { user, rows, subjects: await subjects, totalCount: feed.count };
};

/**
 * The student's own two mutations.
 *
 * Both are form actions, so the write and the re-render are one round trip and the cookie
 * stays first-party throughout. A 401 is reported as such rather than leaving a dead
 * checkbox on screen: a session can end at any moment, including because an administrator
 * deactivated the account (R12).
 */
export const actions: Actions = {
	toggle: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const completed = String(form.get('completed')) === 'true';
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { error: 'That entry could not be identified.' });
		}

		const session = cookies.get('app_session');
		try {
			await setCompleted(id, completed, {
				cookie: session ? `app_session=${session}` : undefined,
				fetch
			});
		} catch (failure) {
			if (failure instanceof ApiError && failure.isUnauthenticated) {
				return fail(401, { error: 'Your session has ended. Please sign in again.' });
			}
			return fail(502, { error: errorMessage(failure, 'Could not save that.') });
		}
		return { ok: true as const, id, completed };
	},

	note: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const note = String(form.get('note') ?? '').trim();
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { error: 'That entry could not be identified.' });
		}
		// The backend bounds this too; checked here so an oversized paste gets a message
		// instead of a round trip.
		if (note.length > 4000) {
			return fail(400, { error: 'That note is longer than 4000 characters.' });
		}

		const session = cookies.get('app_session');
		try {
			await setEntryNote(id, note, {
				cookie: session ? `app_session=${session}` : undefined,
				fetch
			});
		} catch (failure) {
			if (failure instanceof ApiError && failure.isUnauthenticated) {
				return fail(401, { error: 'Your session has ended. Please sign in again.' });
			}
			return fail(502, { error: errorMessage(failure, 'Could not save that note.') });
		}
		return { ok: true as const, id, note };
	}
};