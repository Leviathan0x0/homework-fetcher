import { getSubjects, getTeacherHomework } from '$lib/api';
import { requireSession } from '$lib/server/session';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The administrator's overview.
 *
 * Deliberately thin, and the reason is a real limitation rather than a choice: the API has
 * no admin listing endpoints. There is no "list users", no "list classes", no "roster".
 * R12 made account lifecycle a **CLI** operation on purpose -- `mmss-backend accounts
 * deactivate --roster leavers.csv` -- so an admin in a browser can observe the deployment
 * but cannot change anybody's account.
 *
 * Controls that called a nonexistent endpoint, or worse, that reached around the CLI into
 * the database, would be worse than showing the truth about what is possible here.
 */
export const load: PageServerLoad = async ({ cookies, fetch, parent }) => {
	const session = cookies.get('app_session');
	const cookie = session ? `app_session=${session}` : undefined;
	const user = await requireSession(parent, '/admin');

	// An administrator is also `isTeacher` on the backend, so the teacher API answers for
	// them. That is what makes a school-wide summary possible at all. A teacher who types
	// this URL is sent to their own landing page rather than shown a 403, because the
	// backend has already made the decision and this is only presentation.
	const isAdminAccount = user.isAdmin || user.role === 'admin';
	if (!isAdminAccount) redirect(302, '/homework?denied=admin');

	let entries = 0;
	const classes = new Map<number, string>();
	try {
		const list = await getTeacherHomework({ cookie, fetch });
		entries = list.count;
		for (const item of list.items) classes.set(item.classId, item.className);
	} catch {
		// A summary that cannot be counted still has something honest to say.
	}

	const subjects = await getSubjects({ cookie, fetch }).catch(() => []);

	return {
		user,
		summary: {
			entries,
			classes: [...classes.entries()]
				.map(([id, name]) => ({ id, name }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			subjects: subjects.length
		}
	};
};