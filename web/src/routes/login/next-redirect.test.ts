/**
 * The redirect guard on `?next=`.
 *
 * This is an open-redirect guard, so the test is about what a *hostile* value does rather
 * than what a well-behaved one does. `/\evil.example` is the case that matters: it starts
 * with a single slash, so a check for `//` passes it, and browsers normalise `\` to `/`
 * in a special-scheme URL -- so the browser lands on `evil.example` while the guard
 * believed it had stopped.
 */
import { describe, expect, it } from 'vitest';
import { homeRouteFor } from '$lib/server/session';

/** The rule as `login/+page.server.ts` applies it. */
function destinationFor(next: string | null, account: Parameters<typeof homeRouteFor>[0]) {
	return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
		? next
		: homeRouteFor(account);
}

const student = {
	studentId: '2026001',
	displayName: 'Aarav Sharma',
	role: 'student',
	isTeacher: false,
	isAdmin: false,
	section: '9-A'
} as Parameters<typeof homeRouteFor>[0];

describe('the ?next= open-redirect guard', () => {
	it('follows a path inside the app', () => {
		expect(destinationFor('/settings', student)).toBe('/settings');
		expect(destinationFor('/teacher?edit=4', student)).toBe('/teacher?edit=4');
	});

	it('refuses anything that could leave the origin', () => {
		// Every one of these would send the browser off the site.
		for (const hostile of [
			'//evil.example',
			'//evil.example/path',
			'https://evil.example',
			'http://evil.example',
			'/\\evil.example',
			'\\/evil.example',
			'\\\\evil.example'
		]) {
			expect(destinationFor(hostile, student)).toBe('/homework');
		}
	});

	it('falls back to the account landing page when there is no next at all', () => {
		expect(destinationFor(null, student)).toBe('/homework');
		expect(destinationFor('', student)).toBe('/homework');
	});
});