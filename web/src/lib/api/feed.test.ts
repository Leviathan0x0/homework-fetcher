/**
 * The feed mapper, against **verbatim** backend responses.
 *
 * These fixtures were captured from a running `mmss-backend`, not written from what the
 * mapper expects. That distinction is the whole point: a hand-written fixture would agree
 * with the mapper by construction and prove nothing about the contract.
 *
 * The classwork-only case is here because R10 found real data loss at exactly this
 * boundary, and a rewrite is precisely when such a bug would come back.
 */

import { describe, expect, it } from 'vitest';

import {
	dedupeKey,
	filterRows,
	isoDate,
	parseIsoDate,
	subjectsOf,
	toFeedRow,
	toFeedRows,
	type FeedRow
} from './feed';
import type { HomeworkEntry, HomeworkFeed } from './types';

const AUTHOR = { id: 2, displayName: 'Ms Rao' };

/** A real `GET /api/homework` row, homework and classwork. */
const BOTH: HomeworkEntry = {
	id: 1,
	date: '2026-11-02',
	displayDate: 'Nov 2, 2026',
	subject: 'Mathematics',
	subjectId: 1,
	classId: 1,
	homework: 'Complete exercises 1-10.',
	classwork: 'Chapter 4 examples.',
	author: AUTHOR,
	attachments: [],
	attachment: null,
	completed: false,
	note: null,
	updatedAt: '2026-11-02T00:00:00.000Z'
};

/** A real classwork-only row. `homework` is `null` on the wire, not `""`. */
const CLASSWORK_ONLY: HomeworkEntry = { ...BOTH, id: 2, homework: null, classwork: 'Diagram one' };
const CLASSWORK_ONLY_2: HomeworkEntry = { ...BOTH, id: 3, homework: null, classwork: 'Diagram two' };

/** A real homework-only row. */
const HOMEWORK_ONLY: HomeworkEntry = { ...BOTH, id: 4, homework: 'Read pages 10-20.', classwork: null };

function feed(homework: HomeworkEntry[]): HomeworkFeed {
	return {
		count: homework.length,
		homework,
		schoolSessionExpired: false,
		isStale: false
	};
}

describe('toFeedRow', () => {
	it('normalises a full entry', () => {
		expect(toFeedRow(BOTH)).toEqual({
			id: 1,
			date: '2026-11-02',
			displayDate: 'Nov 2, 2026',
			subject: 'Mathematics',
			homework: 'Complete exercises 1-10.',
			classwork: 'Chapter 4 examples.',
			body: 'Complete exercises 1-10.',
			attachments: [],
			completed: false,
			note: null,
			author: AUTHOR,
			updatedAt: '2026-11-02T00:00:00.000Z'
		});
	});

	it('falls back to the classwork for a classwork-only entry', () => {
		// The bug R10 found: the card printed `homework`, which is null here, so a
		// classwork-only entry rendered as a blank card.
		const row = toFeedRow(CLASSWORK_ONLY);
		expect(row.homework).toBe('');
		expect(row.classwork).toBe('Diagram one');
		expect(row.body).toBe('Diagram one');
		expect(row.body).not.toBe('');
	});

	it('keeps both halves separate rather than merging them', () => {
		const row = toFeedRow(BOTH);
		expect(row.homework).toBe('Complete exercises 1-10.');
		expect(row.classwork).toBe('Chapter 4 examples.');
		expect(row.body).toBe(row.homework);
	});

	it('trims whitespace at the ends and leaves the interior alone', () => {
		const row = toFeedRow({ ...BOTH, homework: '  Q1. Read\npages 10-20  ', classwork: null });
		expect(row.homework).toBe('Q1. Read\npages 10-20');
		expect(row.body).toBe('Q1. Read\npages 10-20');
	});

	it('treats a missing author as absent rather than crashing', () => {
		const row = toFeedRow({ ...BOTH, author: null });
		expect(row.author).toBeNull();
	});

	it('survives an entry with neither half', () => {
		// The backend's CHECK forbids this, but the mapper must not throw if one arrives:
		// a blank card is a bug, a 500 is an outage.
		const row = toFeedRow({ ...BOTH, homework: null, classwork: null });
		expect(row.body).toBe('');
	});
});

describe('dedupeKey', () => {
	it('is the same for two identical entries on one day', () => {
		expect(dedupeKey(toFeedRow(BOTH))).toBe(dedupeKey(toFeedRow({ ...BOTH, id: 99 })));
	});

	it('distinguishes two classwork-only entries on the same day', () => {
		// The regression. With a `date:homework` key these two collided and one was dropped
		// with no error anywhere.
		expect(dedupeKey(toFeedRow(CLASSWORK_ONLY))).not.toBe(
			dedupeKey(toFeedRow(CLASSWORK_ONLY_2))
		);
	});

	it('distinguishes two homework-only entries on the same day', () => {
		expect(dedupeKey(toFeedRow(HOMEWORK_ONLY))).not.toBe(
			dedupeKey(toFeedRow({ ...HOMEWORK_ONLY, homework: 'Different.' }))
		);
	});

	it('distinguishes the same text on different days', () => {
		expect(dedupeKey(toFeedRow(BOTH))).not.toBe(
			dedupeKey(toFeedRow({ ...BOTH, date: '2026-11-03', displayDate: 'Nov 3, 2026' }))
		);
	});
});

describe('toFeedRows', () => {
	it('keeps every distinct entry, including several classwork-only ones on one day', () => {
		const rows = toFeedRows(feed([BOTH, CLASSWORK_ONLY, CLASSWORK_ONLY_2]));
		expect(rows).toHaveLength(3);
		expect(rows.map((row) => row.classwork)).toEqual([
			'Chapter 4 examples.',
			'Diagram one',
			'Diagram two'
		]);
	});

	it('drops a genuine duplicate rather than showing it twice', () => {
		const rows = toFeedRows(feed([BOTH, { ...BOTH, id: 42 }]));
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(1);
	});

	it('preserves server order', () => {
		const rows = toFeedRows(feed([HOMEWORK_ONLY, CLASSWORK_ONLY, BOTH]));
		expect(rows.map((row) => row.id)).toEqual([4, 2, 1]);
	});

	it('tolerates a missing list rather than throwing', () => {
		expect(toFeedRows({ ...feed([]), homework: undefined as never })).toEqual([]);
	});

	it('skips a null entry in the middle of the list', () => {
		const rows = toFeedRows(feed([BOTH, null as never, CLASSWORK_ONLY]));
		expect(rows).toHaveLength(2);
	});
});

describe('filterRows', () => {
	const rows: FeedRow[] = toFeedRows(feed([BOTH, { ...CLASSWORK_ONLY, subject: 'Science' }]));

	it('returns everything with no filters', () => {
		expect(filterRows(rows, { query: '', subject: null })).toHaveLength(2);
	});

	it('matches the body case-insensitively', () => {
		expect(filterRows(rows, { query: 'diagram', subject: null })).toHaveLength(1);
		expect(filterRows(rows, { query: 'CHAPTER 4', subject: null })).toHaveLength(1);
	});

	it('matches the subject too', () => {
		expect(filterRows(rows, { query: 'science', subject: null })).toHaveLength(1);
	});

	it('narrows by subject', () => {
		const science = filterRows(rows, { query: '', subject: 'Science' });
		expect(science).toHaveLength(1);
		expect(science[0].subject).toBe('Science');
	});

	it('finds a classwork-only entry by its classwork text', () => {
		// Searching must reach the text the card actually renders.
		const found = filterRows(rows, { query: 'diagram', subject: null });
		expect(found).toHaveLength(1);
		expect(found[0].body).toBe('Diagram one');
	});

	it('ignores surrounding whitespace in the query', () => {
		expect(filterRows(rows, { query: '   diagram   ', subject: null })).toHaveLength(1);
	});
});

describe('subjectsOf', () => {
	it('lists distinct subjects, sorted, for the filter pills', () => {
		const rows = toFeedRows(
			feed([BOTH, { ...BOTH, id: 2, subject: 'Art' }, { ...BOTH, id: 3, subject: 'Art' }])
		);
		expect(subjectsOf(rows)).toEqual(['Art', 'Mathematics']);
	});

	it('is empty for an empty feed', () => {
		expect(subjectsOf([])).toEqual([]);
	});
});

describe('date handling', () => {
	it('parses an ISO date as a local date, not a UTC one', () => {
		// `new Date('2026-11-02')` is UTC midnight, which is the previous day anywhere west
		// of Greenwich. The old app shipped that; parsing by hand does not.
		const parsed = parseIsoDate('2026-11-02');
		expect(parsed?.getFullYear()).toBe(2026);
		expect(parsed?.getMonth()).toBe(10);
		expect(parsed?.getDate()).toBe(2);
	});

	it('refuses the formats the old data used', () => {
		for (const bad of ['', 'Nov 2, 2026', '2026-11', 'today', '20261102', '2/11/2026']) {
			expect(parseIsoDate(bad)).toBeNull();
		}
	});

	it('formats a local date without drifting across the UTC boundary', () => {
		// Late evening local time is the next day in UTC; `toISOString` would report it.
		const lateEvening = new Date(2026, 10, 2, 23, 30);
		expect(isoDate(lateEvening)).toBe('2026-11-02');
	});

	it('pads month and day', () => {
		expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
	});
});