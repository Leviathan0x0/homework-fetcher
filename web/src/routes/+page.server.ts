import { homeRouteFor } from '$lib/server/session';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The front door: go where the account belongs.
 *
 * The backend's `/auth/me` is the only thing consulted, so a student cannot reach the
 * teacher area by editing a cookie and an administrator cannot be stranded on the student
 * feed because the layout remembered the wrong thing.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { session } = await parent();
	redirect(302, homeRouteFor(session.user));
};
