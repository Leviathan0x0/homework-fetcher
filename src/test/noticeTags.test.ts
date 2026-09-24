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

  it('keeps circulars as circulars', () => {
    expect(
      getNoticeTag({
        kind: 'circulars',
        type: 'Circular',
        title: 'Fee payment',
        content: 'Circular details',
      })
    ).toBe('circular');
  });
});
