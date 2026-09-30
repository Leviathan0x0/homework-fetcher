import { describe, expect, it } from 'vitest';
import { buildCrumbs } from '../components/site-header';

describe('header breadcrumbs', () => {
  it('shows only the page when already on the student home view', () => {
    expect(buildCrumbs('today', 'student')).toEqual([
      { key: 'current', label: "Today's homework" },
    ]);
  });

  it('links home and section back to real views on a nested page', () => {
    const crumbs = buildCrumbs('attachments', 'student');

    expect(crumbs.map((c) => c.label)).toEqual(['Today', 'Library', 'Attachments']);
    expect(crumbs[0].target).toBe('today');
    expect(crumbs[1].target).toBe('recent');
    expect(crumbs[2].target).toBeUndefined();
  });

  it('never links the current page to itself', () => {
    for (const view of ['today', 'recent', 'attachments', 'settings', 'admin-reports', 'teacher-duties'] as const) {
      const crumbs = buildCrumbs(view, 'student');
      const last = crumbs[crumbs.length - 1];
      expect(last.key).toBe('current');
      expect(last.target).toBeUndefined();
    }
  });

  it('roots admin and teacher trails at their own overview', () => {
    expect(buildCrumbs('admin-students', 'admin')[0]).toEqual({
      key: 'home',
      label: 'Overview',
      target: 'admin-overview',
    });
    expect(buildCrumbs('teacher-attendance', 'teacher')[0]).toEqual({
      key: 'home',
      label: 'Overview',
      target: 'teacher-overview',
    });
  });

  it('drops the section crumb when it would repeat the home view', () => {
    // "Faculty portal" and the teacher home are both teacher-overview.
    const crumbs = buildCrumbs('teacher-overview', 'teacher');
    expect(crumbs).toEqual([{ key: 'current', label: 'Teacher dashboard' }]);
  });
});
