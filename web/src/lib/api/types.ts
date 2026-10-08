/**
 * The Rust backend's wire shapes, transcribed.
 *
 * Every field here was read off a live `mmss-backend` response, not off the old frontend's
 * TypeScript types -- the backend is the source of truth from R10 onward, and the old
 * `src/types/homework.ts` had drifted from it in both directions.
 *
 * The naming convention is the backend's own: `AccountView` fields are camelCase because
 * `serde(rename_all = "camelCase")`, and everything else is a plain struct field name.
 */

/** `users.role`, as `serde(rename_all = "lowercase")` serialises it. */
export type Role = 'student' | 'teacher' | 'admin';

/**
 * `AccountView` -- what `/auth/login`, `/auth/me` and `/auth/profile` put in `user`.
 *
 * `section` is the class **name** ("9-F"), not the id, and was added in R10. `classId` is
 * still here for clients that key on the id.
 */
export interface Account {
	id: number;
	studentId: string;
	displayName: string | null;
	classId: number | null;
	section: string | null;
	role: Role;
	isAdmin: boolean;
	isTeacher: boolean;
}

/** `POST /auth/login` on success. */
export interface LoginResponse {
	authenticated: true;
	/** Also delivered as an `app_session` cookie; present for clients that cannot hold one. */
	token: string;
	user: Account;
}

/** `GET /auth/me` when signed in. Answers 200 with `{authenticated:false}` otherwise. */
export interface MeAuthenticated {
	authenticated: true;
	user: Account;
}

export interface MeAnonymous {
	authenticated: false;
}

export type MeResponse = MeAuthenticated | MeAnonymous;

/** One attachment's *metadata*. R2 deliberately stores no file bytes. */
export interface Attachment {
	id: number;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	storageKey: string;
	/** Epoch milliseconds. */
	createdAt: number;
}

/** `author` on a homework view. Deliberately minimal -- an id and a name, nothing else. */
export interface Author {
	id: number;
	displayName: string | null;
}

/**
 * A row in the student feed, from `GET /homework`.
 *
 * Note the two date fields: `date` is the school day (`YYYY-MM-DD`) and `displayDate` is
 * the label the server already formatted (`"Nov 2, 2026"`). Both are used, and the backend
 * formats rather than the client so a single implementation is authoritative.
 */
export interface HomeworkEntry {
	id: number;
	/** `YYYY-MM-DD` -- sorts and ranges as a string. */
	date: string;
	/** `"Nov 2, 2026"`, formatted by the backend. */
	displayDate: string;
	subject: string;
	subjectId: number;
	classId: number;
	/** `null` for a classwork-only entry. */
	homework: string | null;
	/** `null` for a homework-only entry. */
	classwork: string | null;
	author: Author | null;
	attachments: Attachment[];
	/** Legacy single-attachment alias. `null` unless exactly one is declared. */
	attachment: string | null;
	completed: boolean;
	/** The student's own note on this entry, or `null`. */
	note: string | null;
	/** ISO-8601 here, unlike every other timestamp in the API. */
	updatedAt: string | null;
}

export interface HomeworkFeed {
	count: number;
	homework: HomeworkEntry[];
	/** Always false: R4 stopped scraping the portal, so it cannot expire. Kept for shape. */
	schoolSessionExpired: boolean;
	/** Always false, for the same reason. See `homeworkLoader`. */
	isStale: boolean;
}

/**
 * A teacher's own view of an entry, from `/teacher/homework`.
 *
 * Different from `HomeworkEntry` in three ways that matter: it carries `className`, it has
 * `createdAt`/`updatedAt` as epoch milliseconds rather than an ISO string, and it has no
 * per-student `completed` or `note` -- those belong to a student, not to the entry.
 */
export interface TeacherHomework {
	id: number;
	classId: number;
	className: string;
	subjectId: number;
	subject: string;
	dueDate: string;
	homework: string | null;
	classwork: string | null;
	author: Author | null;
	attachments: Attachment[];
	/** Epoch milliseconds. */
	createdAt: number;
	/** Epoch milliseconds. */
	updatedAt: number;
}

export interface TeacherHomeworkList {
	count: number;
	items: TeacherHomework[];
}

export interface Subject {
	id: number;
	name: string;
}

export interface Note {
	id: number;
	/** `null` for a free-standing note that is not about one entry. */
	homeworkId: number | null;
	body: string;
	/** Epoch milliseconds. */
	createdAt: number;
	/** Epoch milliseconds. */
	updatedAt: number;
}

export interface Progress {
	homeworkId: number;
	completed: boolean;
	/** Epoch milliseconds, or 0 when the student has never touched it. */
	updatedAt: number;
}

/** `POST/PATCH /auth/profile`. The whole account, because the client rebuilds from it. */
export interface ProfileResponse {
	user: Account;
}

/** `PATCH /auth/password`. */
export interface PasswordChangedResponse {
	success: boolean;
	user: Account;
}

/** The envelope every error in the API uses: `{error, code}`. */
export interface ApiErrorBody {
	error: string;
	code: string;
}

/** What the backend accepts when a teacher creates an entry. */
export interface NewHomework {
	classId: number;
	subjectId: number;
	/** `YYYY-MM-DD`. Anything else is a 400 -- the backend validates strictly. */
	dueDate: string;
	homework?: string | null;
	classwork?: string | null;
	attachments?: AttachmentInput[];
}

/** A partial update. `undefined` means unchanged; `null` means cleared. */
export interface HomeworkUpdate {
	classId?: number | null;
	subjectId?: number | null;
	dueDate?: string | null;
	homework?: string | null;
	classwork?: string | null;
}

export interface AttachmentInput {
	filename: string;
	mimeType: string;
	sizeBytes: number;
	storageKey: string;
}