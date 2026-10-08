import {
	ApiError,
	createTeacherHomework,
	deleteTeacherHomework,
	errorMessage,
	getTeacherHomework,
	updateTeacherHomework
} from '$lib/api';
import { requireSession } from '$lib/server/session';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * The classes and subjects a teacher may write to.
 *
 * There is no "my classes" or "my subjects" endpoint, so both sets are derived from the
 * teacher's own homework. `GET /subjects` is not an alternative: it is a student route and
 * answers 403 to a teacher, which is how the subject picker ended up permanently empty.
 *
 * That is honest rather than convenient: the create form can only ever offer a class and
 * subject the backend has already accepted an entry for, and the backend still re-checks
 * every write. A teacher with no entries yet gets no options, which is a real limitation --
 * R5 left class assignment an operator job via the provisioning roster, so this is where it
 * shows.
 */
function optionsFrom(items: { classId: number; className: string; subjectId: number; subject: string }[]) {
	const classes = new Map<number, string>();
	const subjects = new Map<number, string>();
	for (const item of items) {
		classes.set(item.classId, item.className);
		subjects.set(item.subjectId, item.subject);
	}
	const list = (seen: Map<number, string>) =>
		[...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
	return { classes: list(classes), subjects: list(subjects) };
}

export const load: PageServerLoad = async ({ cookies, fetch, url, parent }) => {
	const session = cookies.get('app_session');
	const cookie = session ? `app_session=${session}` : undefined;
	const user = await requireSession(parent, '/teacher');

	// A 403 here is the backend refusing a student who typed this URL. Redirecting to their
	// own landing page with a note is better than a bare 403 page, and the backend has
	// already done the deciding.
	let list;
	try {
		list = await getTeacherHomework({ cookie, fetch });
	} catch (failure) {
		if (failure instanceof ApiError && failure.isForbidden) {
			redirect(302, '/homework?denied=teacher');
		}
		throw error(500, 'Could not load your classes.');
	}

	const editing = url.searchParams.get('edit');
	const editingEntry = editing ? (list.items.find((item) => item.id === Number(editing)) ?? null) : null;
	const options = optionsFrom(list.items);

	return {
		user,
		items: list.items,
		classes: options.classes,
		subjects: options.subjects,
		editing: editingEntry
	};
};

function context(cookies: { get: (name: string) => string | undefined }) {
	const session = cookies.get('app_session');
	return { cookie: session ? `app_session=${session}` : undefined };
}

/**
 * The three teacher writes.
 *
 * Each one maps the backend's refusal onto something a teacher can act on. A 403 in
 * particular is *not* checked client-side: the brief is explicit that the backend stays
 * authoritative, and a form that greys out an option but still trusted the server would be
 * two sources of truth.
 */
export const actions: Actions = {
	create: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const classId = Number(form.get('classId'));
		const subjectId = Number(form.get('subjectId'));
		const dueDate = String(form.get('dueDate') ?? '').trim();
		const homework = String(form.get('homework') ?? '').trim();
		const classwork = String(form.get('classwork') ?? '').trim();

		if (!Number.isInteger(classId) || classId <= 0) {
			return fail(400, { error: 'Choose a class.' });
		}
		if (!Number.isInteger(subjectId) || subjectId <= 0) {
			return fail(400, { error: 'Choose a subject.' });
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
			return fail(400, { error: 'Pick a due date.', dueDate, homework, classwork });
		}
		// The backend refuses an entry with neither half; saying so here saves a round trip
		// and gives a message in the teacher's own terms.
		if (!homework && !classwork) {
			return fail(400, {
				error: 'Write some homework, some classwork, or both.',
				dueDate,
				homework,
				classwork
			});
		}

		try {
			await createTeacherHomework(
				{ classId, subjectId, dueDate, homework: homework || null, classwork: classwork || null },
				{ ...context(cookies), fetch }
			);
		} catch (failure) {
			return fail(statusFor(failure), { message: teacherMessage(failure), error: teacherMessage(failure) });
		}
		return { ok: true as const, created: true };
	},

	update: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const homework = String(form.get('homework') ?? '').trim();
		const classwork = String(form.get('classwork') ?? '').trim();
		const dueDate = String(form.get('dueDate') ?? '').trim();

		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { error: 'That entry could not be identified.' });
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
			return fail(400, { error: 'Pick a due date.', id, dueDate, homework, classwork });
		}
		if (!homework && !classwork) {
			return fail(400, {
				error: 'An entry needs homework, classwork, or both.',
				id,
				dueDate,
				homework,
				classwork
			});
		}

		try {
			await updateTeacherHomework(
				id,
				{ homework: homework || null, classwork: classwork || null, dueDate },
				{ ...context(cookies), fetch }
			);
		} catch (failure) {
			return fail(statusFor(failure), { error: teacherMessage(failure) });
		}
		return { ok: true as const, updated: id };
	},

	remove: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) {
			return fail(400, { error: 'That entry could not be identified.' });
		}
		try {
			await deleteTeacherHomework(id, { ...context(cookies), fetch });
		} catch (failure) {
			return fail(statusFor(failure), { error: teacherMessage(failure) });
		}
		return { ok: true as const, removed: id };
	}
};

/** A 400 stays a 400; everything else the backend refused is reported as a conflict. */
function statusFor(failure: unknown): number {
	if (failure instanceof ApiError && failure.isBadRequest) return 400;
	return 409;
}

/**
 * What to tell the teacher.
 *
 * A 403's message is the backend's own and it is written for a person ("You are not
 * assigned to that class"), so it is used verbatim. That is the authorization answer, and
 * the frontend's only job is to display it.
 */
function teacherMessage(failure: unknown): string {
	if (failure instanceof ApiError && failure.isBadRequest) return failure.message;
	if (failure instanceof ApiError && failure.isForbidden) {
		return 'You are not assigned to that class.';
	}
	if (failure instanceof ApiError && failure.isNotFound) return 'That entry no longer exists.';
	return errorMessage(failure, 'Could not save that. Please try again.');
}