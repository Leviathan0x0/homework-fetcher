export interface DeadlineDetection {
  hasDeadline: boolean;
  type: 'test' | 'submission' | 'bring' | null;
  label: string | null;
}

export function detectDeadline(text: string): DeadlineDetection {
  if (!text) return { hasDeadline: false, type: null, label: null };

  const lower = text.toLowerCase();

  // Test / Exam Keywords
  const testMatch = text.match(/(?:test|exam|unit test|eval|evaluation)\s+(?:of|on|for|ch|chapter|\d+)?\s*[^.\n]*/i);
  if (testMatch || lower.includes('test of') || lower.includes('test on') || lower.includes('exam')) {
    const rawLabel = testMatch ? testMatch[0].trim() : 'Test / Exam';
    // Truncate if long
    const label = rawLabel.length > 28 ? rawLabel.slice(0, 25) + '...' : rawLabel;
    return {
      hasDeadline: true,
      type: 'test',
      label: label.charAt(0).toUpperCase() + label.slice(1),
    };
  }

  // Submission / Due Keywords
  const submissionMatch = text.match(/(?:submit|submission|due on|due date|fair notebook|complete q\/ans)\s*[^.\n]*/i);
  if (submissionMatch || lower.includes('submit') || lower.includes('due')) {
    return {
      hasDeadline: true,
      type: 'submission',
      label: 'Notebook Submission',
    };
  }

  // Bring / Requirement Keywords
  if (lower.includes('bring') || lower.includes('carry')) {
    const bringMatch = text.match(/(?:bring|carry)\s+[^.\n]*/i);
    const label = bringMatch ? bringMatch[0].trim() : 'Bring Requirement';
    return {
      hasDeadline: true,
      type: 'bring',
      label: label.length > 28 ? label.slice(0, 25) + '...' : label,
    };
  }

  return { hasDeadline: false, type: null, label: null };
}
