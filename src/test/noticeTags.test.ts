import { describe, expect, it } from 'vitest';
import { getNoticeTag } from '../utils/noticeTags';

const importantNotice = (content: string, title?: string) => ({
  kind: 'important' as const,
  type: 'Message',
  title,
  content,
});

describe('getNoticeTag', () => {
  it('detects leave messages from their title or content', () => {
    expect(getNoticeTag(importantNotice('The school will remain closed.'))).toBe('other');
    expect(getNoticeTag(importantNotice('Please share the medical leave form.'))).toBe('leave');
    expect(getNoticeTag(importantNotice('School update', 'Leave'))).toBe('leave');
  });

  it('detects fee payment messages with a basic word regex', () => {
    expect(getNoticeTag(importantNotice('Submit the fee payment receipt.'))).toBe('fee-payment');
    expect(getNoticeTag(importantNotice('The annual fees are due this week.'))).toBe('fee-payment');
    expect(getNoticeTag(importantNotice('Make a payment through the portal.'))).toBe('fee-payment');
  });

  it('categorises circulars by subject so each one gets its own badge', () => {
    const circular = (title: string, content = 'Circular details') => ({
      kind: 'circulars' as const,
      type: 'Announcement',
      title,
      content,
    });

    expect(getNoticeTag(circular('Annual examination schedule'))).toBe('exam');
    expect(getNoticeTag(circular('Fee payment camp'))).toBe('fee-payment');
    expect(getNoticeTag(circular('School remains closed for summer break'))).toBe('holiday');
    expect(getNoticeTag(circular('Sports Day celebration'))).toBe('event');
  });

  it('falls back to the generic circular badge when no rule matches', () => {
    expect(
      getNoticeTag({
        kind: 'circulars',
        type: 'Circular',
        title: 'Parents meeting',
        content: 'Circular details',
      })
    ).toBe('circular');
  });

  it('files exam ahead of event when a circular mentions both', () => {
    expect(
      getNoticeTag({
        kind: 'circulars',
        type: 'Announcement',
        title: 'Annual exam schedule for the Sports Day week',
        content: '',
      })
    ).toBe('exam');
  });
});
