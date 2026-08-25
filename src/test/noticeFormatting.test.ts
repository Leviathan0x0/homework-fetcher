import { describe, expect, it } from 'vitest';
import { formatNoticeContent } from '../utils/noticeFormatting';

describe('formatNoticeContent', () => {
  it('returns empty string when input is empty or nullish', () => {
    expect(formatNoticeContent('')).toBe('');
    expect(formatNoticeContent(null as unknown as string)).toBe('');
    expect(formatNoticeContent(undefined as unknown as string)).toBe('');
  });

  it('bolds standard greetings like "Dear Parent," and "Dear Student,"', () => {
    expect(formatNoticeContent('Dear Parent,')).toBe('**Dear Parent,**');
    expect(formatNoticeContent('Dear Parents,')).toBe('**Dear Parents,**');
    expect(formatNoticeContent('Dear Student,')).toBe('**Dear Student,**');
    expect(formatNoticeContent('Dear Students:')).toBe('**Dear Students:**');
  });

  it('bolds signature lines like "Team manav mangal" and "manav mangal smart school"', () => {
    expect(formatNoticeContent('Team manav mangal')).toBe('**Team manav mangal**');
    expect(formatNoticeContent('Team manav mangal - 21')).toBe('**Team manav mangal - 21**');
    expect(formatNoticeContent('Team manav mangal.')).toBe('**Team manav mangal.**');
    expect(formatNoticeContent('manav mangal smart school')).toBe('**manav mangal smart school**');
  });

  it('normalizes already bolded greetings without double asterisks', () => {
    expect(formatNoticeContent('**Dear Parent,**')).toBe('**Dear Parent,**');
    expect(formatNoticeContent('*Dear Student,*')).toBe('**Dear Student,**');
    expect(formatNoticeContent('**Team manav mangal**')).toBe('**Team manav mangal**');
  });

  it('preserves surrounding content and line breaks', () => {
    const notice = `Dear Parent,\n\nPlease find the schedule for upcoming examinations.\n\nWarm Regards,\nTeam manav mangal`;
    const formatted = formatNoticeContent(notice);

    expect(formatted).toContain('**Dear Parent,**');
    expect(formatted).toContain('Please find the schedule for upcoming examinations.');
    expect(formatted).toContain('**Team manav mangal**');
  });
});
