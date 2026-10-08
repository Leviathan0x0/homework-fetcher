/**
 * Session resolution and the role boundaries it decides.
 *
 * The frontend's job is to *display* what the backend said, so the tests here are about
 * that rule holding: which page an account lands on, when a page redirects to sign-in, and
 * which navigation links appear. What a role may actually *do* is asserted by the backend's
 * own 29 lifecycle tests and the R1-R12 integration suites, not here.
 */

import { describe, expect, it } from 'vitest';

import type { Account } from '$lib/api/types';
import { canUseTeacherArea, homeRouteFor, isAdmin, isUnauthenticated, SESSION_COOKIE } from './session';
import { ApiError } from '$lib/api';

/** The three shapes `/auth/me` returns, taken from the live backend. */
const STUDENT: Account = {
	id: 1,
	studentId: '2026001',
	displayName: 'Aarav Sharma',
	classId: 1,
	section: '9-A',
	role: 'student',
	isAdmin: false,
	isTeacher: false
};

const TEACHER: Account = {
	id: 3,
	studentId: 't001',
	displayName: 'Ms Rao',
	classId: null,
	section: null,
	role: 'teacher',
	isAdmin: false,
	isTeacher: true
};

const ADMIN: Account = {
	id: 2,
	studentId: 'admin',
	displayName: null,
	classId: null,
	section: null,
	role: 'admin',
	isAdmin: true,
	// The backend deliberately reports admins as teachers too, because they can reach the
	// teacher API. Anything that branches on `isTeacher` before `isAdmin` gets this wrong.
	isTeacher: true
};

describe('homeRouteFor', () => {
	it('sends a student to the feed', () => {
		expect(homeRouteFor(STUDENT)).toBe('/homework');
	});

	it('sends a teacher to their classes', () => {
		expect(homeRouteFor(TEACHER)).toBe('/teacher');
	});

	it('sends an administrator to admin, even though they are also a teacher', () => {
		// The old AppShell gated on `isAdmin` first for exactly this reason.
		expect(homeRouteFor(ADMIN)).toBe('/admin');
	});

	it('sends a signed-out caller to sign in', () => {
		expect(homeRouteFor(null)).toBe('/login');
	});
});

describe('role predicates', () => {
	it('marks only the administrator as admin', () => {
		expect(isAdmin(ADMIN)).toBe(true);
		expect(isAdmin(TEACHER)).toBe(false);
		expect(isAdmin(STUDENT)).toBe(false);
		expect(isAdmin(null)).toBe(false);
	});

	it('treats an admin as able to use the teacher area', () => {
		// True on purpose: admins reach the teacher API on the backend.
		expect(canUseTeacherArea(ADMIN)).toBe(true);
		expect(canUseTeacherArea(TEACHER)).toBe(true);
		expect(canUseTeacherArea(STUDENT)).toBe(false);
		expect(canUseTeacherArea(null)).toBe(false);
	});
});

describe('role is read from the backend, never inferred', () => {
	it('trusts `role` when the boolean flags disagree', () => {
		// Defensive: if the backend ever stopped setting `isTeacher` for admins, the role
		// string still says who they are. One source, read once.
		expect(homeRouteFor({ ...ADMIN, isTeacher: false })).toBe('/admin');
	});

	it('accepts the role string on its own', () => {
		expect(homeRouteFor({ ...STUDENT, role: 'teacher', isTeacher: false })).toBe('/teacher');
	});
});

describe('isUnauthenticated', () => {
	it('is true only for a 401', () => {
		expect(isUnauthenticated(new ApiError(401, 'UNAUTHENTICATED', 'no'))).toBe(true);
		expect(isUnauthenticated(new ApiError(403, 'FORBIDDEN', 'no'))).toBe(false);
		expect(isUnauthenticated(new ApiError(404, 'NOT_FOUND', 'no'))).toBe(false);
		expect(isUnauthenticated(new Error('network down'))).toBe(false);
		expect(isUnauthenticated(undefined)).toBe(false);
	});

	it('treats a deactivated account as unauthenticated', () => {
		// R12: deactivation makes every existing session fail validation on the next
		// request. The user sees "sign in again", which is the accurate thing to say --
		// signing in again will also fail, but that is the backend's answer to give.
		expect(isUnauthenticated(new ApiError(401, 'UNAUTHENTICATED', 'Invalid session.'))).toBe(true);
	});
});

describe('SESSION_COOKIE', () => {
	it('matches the name the backend sets', () => {
		expect(SESSION_COOKIE).toBe('app_session');
	});
});
