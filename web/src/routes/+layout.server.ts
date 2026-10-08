import { resolveSession, type Session } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

export const ssr = true;
export const prerender = false;

/**
 * The session, resolved once per navigation and handed to every page.
 *
 * One call, in the root layout, rather than one per page. The old app did the equivalent
 * with a `useEffect` in `AppShell` that every screen then waited on, which meant N screens
 * each holding their own copy of "am I signed in" and their own idea of when to re-check it.
 *
 * A failure here is deliberately *not* swallowed. An unreachable backend is not a
 * signed-out user, and showing a login form for it sends someone to type their password
 * into a page that cannot do anything with it.
 */
export const load: LayoutServerLoad = async ({ cookies, fetch, url }) => {
	const cookie = cookies.get('app_session') ? `app_session=${cookies.get('app_session')}` : undefined;
	const session: Session = await resolveSession({ cookie, fetch });

	return {
		session,
		// So the layout can skip the app chrome entirely on the login and setup screens,
		// which have their own full-bleed design.
		pathname: url.pathname,
		// Set by the redirects that send someone away from an area their account does not
		// have, so the landing page can say why rather than leaving them to guess.
		denied: url.searchParams.get('denied')
	};
};