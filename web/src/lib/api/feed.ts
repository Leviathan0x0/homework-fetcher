/**
 * Turning an API feed into rows the UI can draw.
 *
 * This is the one place where the wire shape and the display shape differ, and it exists
 * because R10 found real data loss at this boundary: the backend keeps `homework` and
 * `classwork` as two separate fields on one entry, and deduping on the homework text alone
 * gave two classwork-only entries on the same day an *identical* key -- so one was silently
 * dropped, with no error anywhere.
 *
 * Keeping that logic here, named and tested, is the point of the rewrite: in the old app it
 * was an inline `for` loop inside a service function, which is why nothing could test it in
 * isolation and why the bug survived review.
 */

import type { HomeworkEntry, HomeworkFeed } from './types';

/** A feed row, after mapping. */
export interface FeedRow {
	id: number;
	/** `YYYY-MM-DD`, as sent. */
	date: string;
	/** `"Nov 2, 2026"`, as the backend formatted it. */
	displayDate: string;
	subject: string;
	homework: string;
	/**
	 * The classwork half, kept separate rather than merged into `homework`.
	 *
	 * An entry can carry homework, classwork, or both, and the card prints whichever one
	 * the teacher actually wrote. Merging them here would lose the distinction the backend
	 * went to the trouble of preserving.
	 */
	classwork: string;
	/** What the card should print: homework if there is any, otherwise the classwork. */
	body: string;
	attachments: HomeworkEntry['attachments'];
	completed: boolean;
	/** The per-entry note, `null` when there is none. */
	note: string | null;
	author: HomeworkEntry['author'];
	updatedAt: string | null;
}

/**
 * Normalises one wire row.
 *
 * `homework` is `null` for a classwork-only entry, so the `?? ''` is load-bearing rather
 * than defensive: it is what turns "no homework" into the empty string the card and the
 * dedupe key both expect.
 */
export function toFeedRow(entry: HomeworkEntry): FeedRow {
	const homework = (entry.homework ?? '').trim();
	const classwork = (entry.classwork ?? '').trim();
	return {
		id: entry.id,
		date: entry.date,
		displayDate: entry.displayDate,
		subject: entry.subject,
		homework,
		classwork,
		// The fallback the old card did not have, and the reason a classwork-only entry no
		// longer renders as a blank card.
		body: homework || classwork,
		attachments: entry.attachments ?? [],
		completed: Boolean(entry.completed),
		note: entry.note ?? null,
		author: entry.author,
		updatedAt: entry.updatedAt
	};
}

/**
 * The identity used to drop a duplicate row.
 *
 * Three fields, because each omission loses a real entry:
 *
 * * without `classwork`, two classwork-only entries on one day collide -- which is the
 *   data-loss bug R10 found in the old frontend;
 * * without `homework`, two homework-only entries on one day collide;
 * * without `subject`, an Art entry and a Maths entry with identical text on the same day
 *   collide, which is not a duplicate at all.
 *
 * `id` is not usable: the backend does not promise it is unique across a feed, which is
 * why the old app keyed on text and why the old app had this bug.
 */
export function dedupeKey(row: FeedRow): string {
	return `${row.date}:${row.subject}:${row.homework}:${row.classwork}`;
}

/** Maps a whole feed, dropping exact duplicates and preserving server order. */
export function toFeedRows(feed: HomeworkFeed): FeedRow[] {
	const seen = new Set<string>();
	const rows: FeedRow[] = [];
	for (const entry of feed.homework ?? []) {
		if (!entry) continue;
		const row = toFeedRow(entry);
		const key = dedupeKey(row);
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push(row);
	}
	return rows;
}

// ------------------------------------------------------------------ filters

export type DateFilter = 'all' | 'today' | 'tomorrow' | 'week' | 'month';

/** `YYYY-MM-DD` for a local date. Built by hand rather than via `toISOString`, which is UTC. */
export function isoDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Parses `YYYY-MM-DD` as a *local* date. `new Date('2026-11-02')` is UTC midnight, which
 *  is the previous day in every timezone west of Greenwich -- a bug the old app shipped. */
export function parseIsoDate(iso: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
	if (!match) return null;
	const [, year, month, day] = match;
	const date = new Date(Number(year), Number(month) - 1, Number(day));
	return Number.isNaN(date.getTime()) ? null : date;
}

export function isToday(iso: string): boolean {
	return iso === isoDate(new Date());
}

/** The `[from, to]` an entry must fall inside for a filter, or `null` for "everything". */
export function dateRange(filter: DateFilter, today = new Date()): { from?: string; to?: string } {
	if (filter === 'all') return {};
	const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	if (filter === 'today') {
		return { from: isoDate(from), to: isoDate(from) };
	}
	if (filter === 'tomorrow') {
		from.setDate(from.getDate() + 1);
		return { from: isoDate(from), to: isoDate(from) };
	}
	if (filter === 'week') {
		const to = new Date(from);
		to.setDate(to.getDate() + 7);
		return { from: isoDate(from), to: isoDate(to) };
	}
	const to = new Date(from);
	to.setMonth(to.getMonth() + 1);
	return { from: isoDate(from), to: isoDate(to) };
}

/**
 * Applies the client-side filters that make the UI feel instant.
 *
 * The search covers *both* halves of an entry, not just `body`. When a teacher writes
 * homework and classwork together the card shows only the homework until the disclosure is
 * opened -- so classwork text is on screen, and text that is on screen has to be findable.
 * Searching `body` alone would silently miss every classwork half.
 */
export function filterRows(rows: FeedRow[], options: { query: string; subject: string | null }): FeedRow[] {
	const query = options.query.trim().toLowerCase();
	return rows.filter((row) => {
		if (options.subject && row.subject !== options.subject) return false;
		if (!query) return true;
		return (
			row.homework.toLowerCase().includes(query) ||
			row.classwork.toLowerCase().includes(query) ||
			row.subject.toLowerCase().includes(query)
		);
	});
}

/** The subjects present in a set of rows, for the filter pills. */
export function subjectsOf(rows: FeedRow[]): string[] {
	return [...new Set(rows.map((row) => row.subject))].sort((a, b) => a.localeCompare(b));
}