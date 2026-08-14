import { describe, expect, it } from 'vitest';
import { SchoolNotice } from '../types/homework';
import {
  countRecentSchoolNotices,
  isRecentSchoolNotice,
} from '../utils/schoolNoticeUtils';

function notice(date: string): SchoolNotice {
  return {
    id: date,
    kind: 'important',
    type: 'Message',
    date,
    content: 'School update',
  };
}

describe('school notice recency', () => {
  const today = new Date(2026, 7, 13, 18, 30);

  it('includes notices published no more than three calendar days ago', () => {
    expect(isRecentSchoolNotice('13 Aug 2026', today)).toBe(true);
    expect(isRecentSchoolNotice('10 Aug 2026', today)).toBe(true);
    expect(isRecentSchoolNotice('09 Aug 2026', today)).toBe(false);
  });

  it('does not count future or unparseable notice dates', () => {
    expect(isRecentSchoolNotice('14 Aug 2026', today)).toBe(false);
    expect(isRecentSchoolNotice('date unavailable', today)).toBe(false);
  });

  it('counts only recent notices while leaving the full notice list intact', () => {
    const notices = [
      notice('13 Aug 2026'),
      notice('11 Aug 2026'),
      notice('10 Aug 2026'),
      notice('09 Aug 2026'),
    ];

    expect(countRecentSchoolNotices(notices, today)).toBe(3);
    expect(notices).toHaveLength(4);
  });
});
