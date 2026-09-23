import { describe, expect, it } from 'vitest';
import {
  parseHomeworkDate,
  isTodayDate,
  selectRecentHomework,
  sortHomeworkNewestFirst,
  formatToISODate,
  formatRelativeDateHeader,
  getHomeworkDateYmd,
} from '../utils/dateUtils';
import { HomeworkEntry } from '../types/homework';

describe('dateUtils - parseHomeworkDate', () => {
  it('parses D MMM YYYY formats and variants', () => {
    const d1 = parseHomeworkDate('11 Aug 2026');
    expect(d1).not.toBeNull();
    expect(d1?.getFullYear()).toBe(2026);
    expect(d1?.getMonth()).toBe(7); // Aug is 7
    expect(d1?.getDate()).toBe(11);

    const d2 = parseHomeworkDate('11-Aug-2026');
    expect(d2?.getMonth()).toBe(7);
    expect(d2?.getDate()).toBe(11);

    const d3 = parseHomeworkDate('11/Aug/2026');
    expect(d3?.getMonth()).toBe(7);
    expect(d3?.getDate()).toBe(11);

    const d4 = parseHomeworkDate('11.Aug.2026');
    expect(d4?.getMonth()).toBe(7);
    expect(d4?.getDate()).toBe(11);
  });

  it('parses ordinal dates accurately (1st, 2nd, 3rd, 4th, 11th)', () => {
    const d1 = parseHomeworkDate('1st Sep 2026');
    expect(d1?.getFullYear()).toBe(2026);
    expect(d1?.getMonth()).toBe(8); // Sep is 8
    expect(d1?.getDate()).toBe(1);

    const d2 = parseHomeworkDate('2nd September 2026');
    expect(d2?.getMonth()).toBe(8);
    expect(d2?.getDate()).toBe(2);

    const d3 = parseHomeworkDate('3rd March 2026');
    expect(d3?.getMonth()).toBe(2); // Mar is 2
    expect(d3?.getDate()).toBe(3);

    const d4 = parseHomeworkDate('11th Aug 2026');
    expect(d4?.getMonth()).toBe(7);
    expect(d4?.getDate()).toBe(11);
  });

  it('parses DMY numeric dates with any separator', () => {
    const d1 = parseHomeworkDate('11/08/2026');
    expect(d1?.getFullYear()).toBe(2026);
    expect(d1?.getMonth()).toBe(7); // Aug
    expect(d1?.getDate()).toBe(11);

    const d2 = parseHomeworkDate('11-08-2026');
    expect(d2?.getMonth()).toBe(7);
    expect(d2?.getDate()).toBe(11);

    const d3 = parseHomeworkDate('11.08.2026');
    expect(d3?.getMonth()).toBe(7);
    expect(d3?.getDate()).toBe(11);

    const d4 = parseHomeworkDate('1/9/26');
    expect(d4?.getFullYear()).toBe(2026);
    expect(d4?.getMonth()).toBe(8); // Sep
    expect(d4?.getDate()).toBe(1);
  });

  it('parses ISO dates YYYY-MM-DD', () => {
    const d1 = parseHomeworkDate('2026-08-11');
    expect(d1?.getFullYear()).toBe(2026);
    expect(d1?.getMonth()).toBe(7);
    expect(d1?.getDate()).toBe(11);

    const d2 = parseHomeworkDate('2026-08-11T10:30:00.000Z');
    expect(d2?.getFullYear()).toBe(2026);
    expect(d2?.getMonth()).toBe(7);
    expect(d2?.getDate()).toBe(11);
  });

  it('parses dates with weekday prefixes and time suffixes', () => {
    const d1 = parseHomeworkDate('Monday, 11 Aug 2026');
    expect(d1?.getMonth()).toBe(7);
    expect(d1?.getDate()).toBe(11);

    const d2 = parseHomeworkDate('Tuesday, 1st September 2026, 11:00 AM');
    expect(d2?.getFullYear()).toBe(2026);
    expect(d2?.getMonth()).toBe(8);
    expect(d2?.getDate()).toBe(1);

    const d3 = parseHomeworkDate('11-08-2026 09:15');
    expect(d3?.getMonth()).toBe(7);
    expect(d3?.getDate()).toBe(11);
  });

  it('parses relative keywords (today, yesterday)', () => {
    const today = new Date();
    const dToday = parseHomeworkDate('today');
    expect(dToday?.getDate()).toBe(today.getDate());
    expect(dToday?.getMonth()).toBe(today.getMonth());
    expect(dToday?.getFullYear()).toBe(today.getFullYear());

    const dYesterday = parseHomeworkDate('yesterday');
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(dYesterday?.getDate()).toBe(yesterday.getDate());
    expect(dYesterday?.getMonth()).toBe(yesterday.getMonth());
    expect(dYesterday?.getFullYear()).toBe(yesterday.getFullYear());
  });

  it('returns null for invalid or empty dates', () => {
    expect(parseHomeworkDate('')).toBeNull();
    expect(parseHomeworkDate(null)).toBeNull();
    expect(parseHomeworkDate(undefined)).toBeNull();
    expect(parseHomeworkDate('not a date')).toBeNull();
  });
});

describe('dateUtils - isTodayDate', () => {
  it('correctly identifies today across various string formats', () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');

    expect(isTodayDate(`${yyyy}-${mm}-${dd}`)).toBe(true);
    expect(isTodayDate(`${dd}/${mm}/${yyyy}`)).toBe(true);
    expect(isTodayDate(`${dd}-${mm}-${yyyy}`)).toBe(true);
    expect(isTodayDate('today')).toBe(true);
    expect(isTodayDate('TODAY')).toBe(true);
    expect(isTodayDate('yesterday')).toBe(false);
  });

  it('returns false for past or future dates', () => {
    expect(isTodayDate('2020-01-01')).toBe(false);
    expect(isTodayDate('01 Jan 2020')).toBe(false);
    expect(isTodayDate('')).toBe(false);
    expect(isTodayDate(null)).toBe(false);
  });
});

describe('dateUtils - selectRecentHomework', () => {
  const entry = (id: string, date: string): HomeworkEntry => ({
    id, date, type: 'Homework', homework: `Homework ${id}`, attachment: null,
  });

  it('takes the 5 newest entries no matter how old they are', () => {
    const today = new Date();
    const ymd = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offsetDays);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const entries: HomeworkEntry[] = [
      entry('old-1', '10 Jul 2026'),
      entry('old-2', '01 Aug 2026'),
      entry('old-3', '15 Aug 2026'),
      entry('old-4', '20 Aug 2026'),
      entry('old-5', '01 Sep 2026'),
      entry('recent-1', ymd(-1)),
      entry('recent-2', ymd(0)),
    ];

    const recent = selectRecentHomework(entries);
    expect(recent.map((e) => e.id)).toEqual([
      'recent-2', 'recent-1', 'old-5', 'old-4', 'old-3',
    ]);
  });

  it('includes future dates as the newest entries', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const entries: HomeworkEntry[] = [
      entry('today', '2026-09-01'),
      entry('tomorrow', tStr),
      entry('very-old', '01 Jan 2026'),
    ];

    const recent = selectRecentHomework(entries, 2);
    expect(recent.map((e) => e.id)).toEqual(['tomorrow', 'today']);
  });

  it('returns all entries when fewer than the limit exist', () => {
    const entries: HomeworkEntry[] = [entry('a', '01 Sep 2026'), entry('b', '02 Sep 2026')];
    const recent = selectRecentHomework(entries);
    expect(recent.map((e) => e.id)).toEqual(['b', 'a']);
    expect(selectRecentHomework([])).toEqual([]);
  });
});

describe('dateUtils - sortHomeworkNewestFirst', () => {
  it('sorts entries newest first', () => {
    const entries: HomeworkEntry[] = [
      { id: '1', date: '01 Aug 2026', type: 'Homework', homework: 'First', attachment: null },
      { id: '2', date: '15 Aug 2026', type: 'Homework', homework: 'Second', attachment: null },
      { id: '3', date: '10 Aug 2026', type: 'Homework', homework: 'Third', attachment: null },
    ];

    const sorted = sortHomeworkNewestFirst(entries);
    expect(sorted.map((e) => e.id)).toEqual(['2', '3', '1']);
  });
});

describe('dateUtils - formatToISODate & getHomeworkDateYmd', () => {
  it('formats various date inputs to YYYY-MM-DD', () => {
    expect(formatToISODate('11 Aug 2026')).toBe('2026-08-11');
    expect(formatToISODate('1st Sep 2026')).toBe('2026-09-01');
    expect(getHomeworkDateYmd('11/08/2026')).toBe('2026-08-11');
  });
});

describe('dateUtils - formatRelativeDateHeader', () => {
  it('returns Today for today and Yesterday for yesterday', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(formatRelativeDateHeader(todayStr)).toBe('Today');

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    expect(formatRelativeDateHeader(yesterdayStr)).toBe('Yesterday');
  });
});

