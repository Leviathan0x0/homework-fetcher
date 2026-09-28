import { describe, expect, it } from 'vitest';
import { detectSubject, homeworkSubjectName } from '../utils/subjectDetector';

describe('detectSubject explicit tags', () => {
  it('keeps the canonical casing of a School Diary tag', () => {
    expect(detectSubject('Bring the signed slip.', 'School Diary').name).toBe('School Diary');
  });

  it('prefers the stored tag over what the homework text says', () => {
    expect(detectSubject('Read chapter 4 and answer the questions.', 'Mathematics').name).toBe(
      'Mathematics'
    );
  });

  it('falls back to School Diary when nothing is known', () => {
    expect(detectSubject('').name).toBe('School Diary');
  });
});

describe('homeworkSubjectName', () => {
  it('reads the subject tag first so filters match the card badge', () => {
    expect(homeworkSubjectName({ homework: 'punjabi text', subject: 'School Diary' })).toBe(
      'School Diary'
    );
    expect(homeworkSubjectName({ homework: 'any text', subject: 'English' })).toBe('English');
  });

  it('detects from the homework text when there is no tag', () => {
    expect(homeworkSubjectName({ homework: 'Mathematics' })).toBe('Mathematics');
    expect(
      homeworkSubjectName({ homework: 'ਪੰਜਾਬੀ ਦੀ ਕਿਤਾਬ ਦਾ ਪਹਿਲਾ ਪੰਨਾ ਯਾਦ ਕਰੋ ਅਤੇ ਅਗਲੇ ਦਿਨ ਸ਼ੇਅਰ ਕਰੋ।' })
    ).toBe('Punjabi');
    expect(homeworkSubjectName(null)).toBe('School Diary');
  });
});
