/**
 * The API surface, one typed function per endpoint.
 *
 * Every function takes an optional {@link ApiContext} carrying the caller's cookie, which
 * is what lets a server-side `load` or a form action call exactly the same code the
 * browser does. There is no second implementation and no client-only path.
 *
 * Nothing here decides *what* a user may do. It asks the backend and reports the answer.
 * Role checks in this file would be a second source of truth, and the one that drifts.
 */

import { request, requestWithCookie, type RequestOptions } from './client';
import type {
	Account,
	Attachment,
	HomeworkEntry,
	HomeworkFeed,
	HomeworkUpdate,
	MeResponse,
	NewHomework,
	Note,
	PasswordChangedResponse,
	ProfileResponse,
	Progress,
	Subject,
	TeacherHomework,
	TeacherHomeworkList
} from './types';

/**
 * A successful authentication, plus the session cookie the backend issued.
 *
 * The cookie is part of the answer, not a side effect the caller has to go looking for: the
 * two endpoints that mint a session are the only two that need it, and returning it here
 * keeps every `Response` inside the API layer.
 */
export interface AuthResult {
	user: Account;
	/** The `app_session` value, or `null` if the server sent no cookie. */
	sessionCookie: string | null;
}

/** The cookie and fetch implementation a call should use. */
export interface ApiContext {
	/** The raw `Cookie` header, forwarded to the backend on the server. */
	cookie?: string;
	fetch?: typeof globalThis.fetch;
}

function opts(context?: ApiContext, extra?: Omit<RequestOptions, 'cookie' | 'fetch'>) {
	return {
		cookie: context?.cookie,
		fetch: context?.fetch,
		...extra
	};
}

// ---------------------------------------------------------------- auth

/**
 * `POST /auth/login`. Rejects with `ApiError(401)` when the credentials do not verify.
 *
 * The backend's 401 is deliberately identical for a wrong password and an unknown school
 * ID, and this does not try to tell them apart -- that would undo a privacy property R3
 * built on purpose.
 */
export async function login(
	studentId: string,
	password: string,
	context?: ApiContext
): Promise<AuthResult> {
	const { data, cookie } = await requestWithCookie<{ user: Account }>('/auth/login', opts(context, {
		method: 'POST',
		body: { studentId, password }
	}));
	return { user: data.user, sessionCookie: cookie };
}

/** `POST /auth/logout`. Revokes the session server-side and clears the cookie. */
export function logout(context?: ApiContext): Promise<{ success: boolean }> {
	return request('/auth/logout', opts(context, { method: 'POST' }));
}

/**
 * `GET /auth/me`.
 *
 * Answers 200 with `authenticated: false` for a signed-out caller -- it does not 401 --
 * so this resolves for everyone. That matters: the session check runs on every page load,
 * and a rejection there would be a branch that never gets exercised.
 */
export function me(context?: ApiContext): Promise<MeResponse> {
	return request('/auth/me', opts(context));
}

/** `PATCH /auth/profile`. Changes the caller's own display name and nothing else. */
export function updateProfile(displayName: string, context?: ApiContext): Promise<ProfileResponse> {
	return request('/auth/profile', opts(context, { method: 'PATCH', body: { displayName } }));
}

/**
 * `PATCH /auth/password`.
 *
 * Revokes every session the account holds -- including the one making this request -- and
 * issues a replacement for this browser. So the replacement cookie is part of the answer,
 * and a caller that ignored it would sign the user out with their own successful change.
 */
export async function changePassword(
	currentPassword: string,
	newPassword: string,
	context?: ApiContext
): Promise<AuthResult> {
	const { data, cookie } = await requestWithCookie<{ user: Account }>(
		'/auth/password',
		opts(context, { method: 'PATCH', body: { currentPassword, newPassword } })
	);
	return { user: data.user, sessionCookie: cookie };
}

/**
 * `POST /auth/password/setup` -- the R12 first-password flow.
 *
 * The only unauthenticated write in the app. It is safe because the setup token *is* the
 * identity verification: 256 bits of CSPRNG, single-use, expiring, and only ever issued
 * for an account that has no password yet.
 */
export async function completeSetup(
	token: string,
	newPassword: string,
	context?: ApiContext
): Promise<AuthResult> {
	const { data, cookie } = await requestWithCookie<{ user: Account }>(
		'/auth/password/setup',
		opts(context, { method: 'POST', body: { token, newPassword } })
	);
	return { user: data.user, sessionCookie: cookie };
}

// ------------------------------------------------------------- homework

/** `GET /homework` -- the student's whole class feed. */
export function getHomework(
	filter: { from?: string; to?: string; subjectId?: number; classId?: number; limit?: number } = {},
	context?: ApiContext
): Promise<HomeworkFeed> {
	const query = new URLSearchParams();
	if (filter.from) query.set('from', filter.from);
	if (filter.to) query.set('to', filter.to);
	if (filter.subjectId !== undefined) query.set('subjectId', String(filter.subjectId));
	if (filter.classId !== undefined) query.set('classId', String(filter.classId));
	if (filter.limit !== undefined) query.set('limit', String(filter.limit));
	const suffix = query.size ? `?${query}` : '';
	return request(`/homework${suffix}`, opts(context));
}

/** `GET /homework/{id}` -- one entry, scoped to the caller's class. */
export function getHomeworkEntry(id: number, context?: ApiContext): Promise<HomeworkEntry> {
	return request(`/homework/${id}`, opts(context));
}

/**
 * `PATCH /homework/{id}/status` -- the legacy alias for progress, which is the URL the
 * existing client used. `POST /progress/{id}` is the same thing.
 */
export function setCompleted(
	id: number,
	completed: boolean,
	context?: ApiContext
): Promise<Progress> {
	return request(`/homework/${id}/status`, opts(context, { method: 'PATCH', body: { completed } }));
}

/** `PATCH /homework/{id}/note` -- the per-entry note, as opposed to a full note. */
export function setEntryNote(id: number, note: string | null, context?: ApiContext): Promise<HomeworkEntry> {
	return request(`/homework/${id}/note`, opts(context, { method: 'PATCH', body: { note } }));
}

/** `GET /homework/{id}/attachments` -- metadata only; R2 stores no file bytes. */
export function getAttachments(id: number, context?: ApiContext): Promise<Attachment[]> {
	return request(`/homework/${id}/attachments`, opts(context));
}

/** `GET /subjects` -- the subjects this deployment teaches. */
export function getSubjects(context?: ApiContext): Promise<Subject[]> {
	return request('/subjects', opts(context));
}

// --------------------------------------------------------------- notes

/** `GET /notes` -- the caller's own notes, newest first. */
export function getNotes(context?: ApiContext): Promise<Note[]> {
	return request('/notes', opts(context));
}

/** `POST /notes` -- a free-standing note. */
export function createNote(body: string, context?: ApiContext): Promise<Note> {
	return request('/notes', opts(context, { method: 'POST', body: { body } }));
}

/** `POST /notes/homework/{homeworkId}` -- upsert the note on one entry. */
export function setNoteForHomework(
	homeworkId: number,
	body: string,
	context?: ApiContext
): Promise<Note> {
	return request(`/notes/homework/${homeworkId}`, opts(context, { method: 'POST', body: { body } }));
}

export function updateNote(id: number, body: string, context?: ApiContext): Promise<Note> {
	return request(`/notes/${id}`, opts(context, { method: 'PATCH', body: { body } }));
}

export function deleteNote(id: number, context?: ApiContext): Promise<{ success: boolean }> {
	return request(`/notes/${id}`, opts(context, { method: 'DELETE' }));
}

// ------------------------------------------------------------ progress

/** `GET /progress` -- the caller's completion state across every entry. */
export function getProgress(context?: ApiContext): Promise<Progress[]> {
	return request('/progress', opts(context));
}

// -------------------------------------------------------------- teacher

/** `GET /teacher/homework` -- every entry the caller may manage, across their classes. */
export function getTeacherHomework(context?: ApiContext): Promise<TeacherHomeworkList> {
	return request('/teacher/homework', opts(context));
}

/**
 * `POST /teacher/homework`.
 *
 * A 403 here is the backend refusing a class the caller does not teach. The message says
 * so and the caller shows it verbatim; there is no client-side pre-check to duplicate.
 */
export function createTeacherHomework(
	input: NewHomework,
	context?: ApiContext
): Promise<TeacherHomework> {
	return request('/teacher/homework', opts(context, { method: 'POST', body: input }));
}

export function updateTeacherHomework(
	id: number,
	update: HomeworkUpdate,
	context?: ApiContext
): Promise<TeacherHomework> {
	return request(`/teacher/homework/${id}`, opts(context, { method: 'PATCH', body: update }));
}

export function deleteTeacherHomework(id: number, context?: ApiContext): Promise<{ success: boolean }> {
	return request(`/teacher/homework/${id}`, opts(context, { method: 'DELETE' }));
}

export type { Account };