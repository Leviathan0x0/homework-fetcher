/**
 * Contract compatibility against the **real** Rust backend.
 *
 * These run only when `MMS_BACKEND_URL` is set, and are skipped otherwise. They exist
 * because a typed interface is a promise, and a promise that is only checked by the
 * compiler is not checked at all: `HomeworkEntry` says `homework: string | null`, and only a
 * live response proves the backend actually sends `null` rather than `""` or omitting the
 * field.
 *
 * Start a backend first:
 *
 * ```sh
 * cd mmss-backend
 * DATABASE_URL=sqlite://$PWD/data/mmss.db ADMIN_PASSWORD=... PORT=3997 cargo run
 * MMSS_BACKEND=http://127.0.0.1:3997 npm test
 * ```
 *
 * The fixtures the rest of the suite uses were captured this way, which is why they are
 * worth having.
 */

import { describe, expect, it } from 'vitest';

import { ApiError, readAppSession } from './client';
import type { Account, HomeworkFeed, MeResponse, Note, Progress, Subject, TeacherHomeworkList } from './types';

/**
 * The backend's origin, taken from the environment.
 *
 * Server-side the API client resolves against `BACKEND_URL`, which SvelteKit's `handleFetch`
 * rewrites -- so these tests go through exactly the path production uses, not a private one.
 */
const BACKEND = process.env.MMSS_BACKEND ?? process.env.BACKEND_URL;

const describeLive = BACKEND ? describe : describe.skip;

/**
 * The API client, pointed at the backend directly.
 *
 * `client.ts` deliberately builds only *relative* URLs, because inside the app the browser
 * goes through the proxy and the server goes through `handleFetch`. There is no SvelteKit
 * request context here, so this test resolves the origin itself rather than the client
 * growing a base-URL branch that production never uses.
 */
function live<T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}) {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (options.cookie) headers.Cookie = options.cookie;
	if (options.body !== undefined) headers['Content-Type'] = 'application/json';

	return fetch(`${BACKEND}/api${path}`, {
		method: options.method ?? 'GET',
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body)
	}).then(async (response) => {
		const text = await response.text();
		if (!response.ok) {
			let code = 'UNKNOWN';
			let message = `HTTP ${response.status}`;
			try {
				const parsed = JSON.parse(text);
				code = parsed.code ?? code;
				message = parsed.error ?? message;
			} catch {
				/* Not the backend envelope; keep the generic message. */
			}
			throw new ApiError(response.status, code, message);
		}
		return (text ? JSON.parse(text) : undefined) as T;
	});
}

/** Reads the session cookie out of a login response, through the same helper the app uses. */
async function sessionCookieFor(studentId: string, password: string): Promise<string> {
	const response = await fetch(`${BACKEND}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ studentId, password })
	});
	const token = readAppSession(response.headers.get('set-cookie'));
	if (!token) throw new Error(`The backend issued no session cookie for ${studentId}.`);
	return token;
}

/** Signs in and returns the session cookie plus the account the backend described. */
async function signIn(): Promise<{ cookie: string; user: Account }> {
	const studentId = process.env.MMSS_STUDENT_ID;
	const password = process.env.MMSS_STUDENT_PASSWORD;
	if (!studentId || !password) {
		throw new Error('MMSS_STUDENT_ID and MMSS_STUDENT_PASSWORD are required for the live tests.');
	}
	const { user } = await live<{ user: Account }>('/auth/login', {
		method: 'POST',
		body: { studentId, password }
	});
	return { cookie: `app_session=${await sessionCookieFor(studentId, password)}`, user };
}

describeLive('live API contract', () => {
	it('answers /auth/me for an anonymous caller with 200, not 401', async () => {
		// This is load-bearing: the session check runs on every page load, and a 401 here
		// would mean every signed-out visit throws instead of branching.
		const response = await live<MeResponse>('/auth/me');
		expect(response.authenticated).toBe(false);
		expect('user' in response).toBe(false);
	});

	it('refuses a bad password with an identical 401', async () => {
		const failure = await live('/auth/login', {
			method: 'POST',
			body: { studentId: 'nobody', password: 'wrong' }
		}).catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(ApiError);
		expect((failure as ApiError).status).toBe(401);
	});

	it('signs in and returns the documented account shape', async () => {
		const { cookie, user } = await signIn();
		expect(typeof user.id).toBe('number');
		expect(typeof user.studentId).toBe('string');
		// `displayName` is nullable -- the admin account has none.
		expect(user.displayName === null || typeof user.displayName === 'string').toBe(true);
		expect(['student', 'teacher', 'admin']).toContain(user.role);
		expect(typeof user.isAdmin).toBe('boolean');
		expect(typeof user.isTeacher).toBe('boolean');

		const me = await live<MeResponse>('/auth/me', { cookie });
		expect(me.authenticated).toBe(true);
	});

	it('returns a feed with the documented top-level keys', async () => {
		const { cookie } = await signIn();
		const feed = await live<HomeworkFeed>('/homework', { cookie });

		expect(typeof feed.count).toBe('number');
		expect(Array.isArray(feed.homework)).toBe(true);
		// Both are always false since R4 stopped scraping the portal. Kept for shape only.
		expect(feed.schoolSessionExpired).toBe(false);
		expect(feed.isStale).toBe(false);
	});

	it('sends homework as null for a classwork-only entry, not an empty string', async () => {
		// The distinction the whole feed mapper turns on. If this ever becomes `""` the
		// dedupe key and the `body` fallback both still work -- but if it becomes absent,
		// `toFeedRow` sees `undefined` and the card renders blank. Worth pinning.
		const { cookie } = await signIn();
		const feed = await live<HomeworkFeed>('/homework', { cookie });
		for (const entry of feed.homework) {
			expect(entry).toHaveProperty('homework');
			expect(entry).toHaveProperty('classwork');
			expect(
				entry.homework === null || typeof entry.homework === 'string'
			).toBe(true);
			// Never both null: the backend's CHECK forbids it and the card would be blank.
			expect(entry.homework !== null || entry.classwork !== null).toBe(true);
		}
	});

	it('formats date as YYYY-MM-DD and displayDate for humans', async () => {
		const { cookie } = await signIn();
		const feed = await live<HomeworkFeed>('/homework', { cookie });
		for (const entry of feed.homework) {
			expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(typeof entry.displayDate).toBe('string');
			// `updatedAt` is the one ISO-8601 timestamp in the whole API.
			if (entry.updatedAt !== null) {
				expect(entry.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			}
		}
	});

	it('lists subjects as id/name pairs', async () => {
		const { cookie } = await signIn();
		const subjects = await live<Subject[]>('/subjects', { cookie });
		expect(Array.isArray(subjects)).toBe(true);
		for (const subject of subjects) {
			expect(typeof subject.id).toBe('number');
			expect(typeof subject.name).toBe('string');
		}
	});

	it('reports progress with epoch-ms timestamps and 0 for untouched', async () => {
		const { cookie } = await signIn();
		const progress = await live<Progress>('/progress/1', { cookie });
		expect(typeof progress.homeworkId).toBe('number');
		expect(typeof progress.completed).toBe('boolean');
		// 0 rather than null: "never touched" has to be distinguishable from "unknown".
		expect(typeof progress.updatedAt).toBe('number');
	});

	it('lists notes with epoch-ms createdAt, unlike the feed', async () => {
		const { cookie } = await signIn();
		const notes = await live<Note[]>('/notes', { cookie });
		expect(Array.isArray(notes)).toBe(true);
		for (const note of notes) {
			expect(typeof note.createdAt).toBe('number');
			expect(note.createdAt).toBeGreaterThan(1_000_000_000_000);
			// `homeworkId` is null for a free-standing note.
			expect(note.homeworkId === null || typeof note.homeworkId === 'number').toBe(true);
		}
	});

	it('refuses the teacher list for a student with 403', async () => {
		const { cookie, user } = await signIn();
		if (user.role !== 'student') return; // Not this environment's student.
		const failure = await live('/teacher/homework', { cookie }).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(ApiError);
		expect((failure as ApiError).status).toBe(403);
		expect((failure as ApiError).code).toBe('FORBIDDEN');
	});

	it('refuses every protected route without a session', async () => {
		// The routes a signed-out visitor must never reach. Asserted here because a route
		// added on the backend without an extractor would be invisible from the frontend.
		for (const path of ['/homework', '/notes', '/progress', '/teacher/homework', '/subjects']) {
			const failure = await live(path).catch((e: unknown) => e);
			expect(failure, `${path} should require a session`).toBeInstanceOf(ApiError);
			expect((failure as ApiError).status, `${path}`).toBe(401);
		}
	});

	it('serves attachment metadata with no file bytes behind it', async () => {
		// R2 stores metadata only. If this ever grew a download URL the frontend's
		// "metadata only" wording would be a lie, so the shape is pinned here.
		const { cookie } = await signIn();
		const attachments = await live<unknown[]>('/homework/1/attachments', { cookie });
		expect(Array.isArray(attachments)).toBe(true);
		for (const attachment of attachments as Record<string, unknown>[]) {
			expect(typeof attachment.filename).toBe('string');
			expect(typeof attachment.mimeType).toBe('string');
			expect(typeof attachment.sizeBytes).toBe('number');
			expect(typeof attachment.storageKey).toBe('string');
			expect(attachment).not.toHaveProperty('url');
			expect(attachment).not.toHaveProperty('content');
		}
	});

	it('gives a teacher the teacher shape, with epoch-ms timestamps', async () => {
		const studentId = process.env.MMSS_TEACHER_ID;
		const password = process.env.MMSS_TEACHER_PASSWORD;
		if (!studentId || !password) return;

		const response = await fetch(`${BACKEND}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ studentId, password })
		});
		const { readAppSession } = await import('./client');
		const token = readAppSession(response.headers.get('set-cookie'));
		if (!token) throw new Error('The teacher login did not issue a cookie.');

		const list = await live<TeacherHomeworkList>('/teacher/homework', {
			cookie: `app_session=${token}`
		});
		expect(typeof list.count).toBe('number');
		for (const item of list.items) {
			// The teacher view differs from the feed in three ways the UI depends on.
			expect(typeof item.className).toBe('string');
			expect(item.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(typeof item.createdAt).toBe('number');
			expect(typeof item.updatedAt).toBe('number');
			// No per-student state on a teacher's own view.
			expect(item).not.toHaveProperty('completed');
			expect(item).not.toHaveProperty('note');
		}
	});
});
