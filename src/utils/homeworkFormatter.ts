/**
 * Utility for automatically formatting raw homework text into clean, structured Markdown.
 */

/**
 * Format raw homework text automatically into structured Markdown.
 */
export function formatHomeworkText(rawText: string): string {
  if (!rawText || !rawText.trim()) return '';

  let text = rawText.trim();

  // 1. Normalize line endings & whitespace
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/[ \t]+/g, ' '); // collapse extra spaces

  // 2. Separate run-on numbered items (e.g. "1) Do Ex 4.1 2) Read ch-3 3) Revise formula")
  // Replace inline numbers like " 2) ", " 3. ", " a) " with newlines if preceded by text
  text = text.replace(/(?<=[^\n])\s+(?=(?:\d+|[a-zA-Z])[\.\)]\s+)/g, '\n');

  // Also split on common inline separators if multiple tasks are packed together (e.g. "; " or " | ")
  text = text.replace(/\s*[|;]\s*/g, '\n');

  // 3. Process line by line
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const formattedLines: string[] = [];

  for (let line of lines) {
    // A. Detect and standardize list items
    const listMatch = line.match(/^(?:[\d+|[a-zA-Z]][\.\)]|[\-\*•])\s*(.*)/);
    if (listMatch) {
      line = listMatch[1].trim();
      line = `- ${line}`;
    } else if (lines.length > 1 && !line.startsWith('>')) {
      // Add bullet point to non-header list items if there are multiple lines
      line = `- ${line}`;
    }

    // B. Highlight Chapters / Units
    line = line.replace(
      /\b((?:ch|chap|chapter|unit)\s*[\.\-]?\s*\d+[a-z]?)\b/gi,
      '**$1**'
    );

    // C. Highlight Exercises
    line = line.replace(
      /\b((?:ex|exer|exercise)\s*[\.\-]?\s*\d+(?:\.\d+)?)\b/gi,
      '**$1**'
    );

    // D. Highlight Pages
    line = line.replace(
      /\b((?:pg|page|pages)\s*[\.\-]?\s*\d+(?:\s*(?:to|\-)\s*\d+)?)\b/gi,
      '**$1**'
    );

    // E. Highlight Questions (e.g. Q1, Q.1, Q1 to 5, Q1-5)
    line = line.replace(
      /\b((?:q|q\.n|q\.no|ques|questions?)\s*[\.\-]?\s*\d+(?:\s*(?:to|\-|,)\s*\d+)*)\b/gi,
      '**$1**'
    );

    // F. Highlight Notebooks / Registers
    line = line.replace(
      /\b(fair\s+notebook|hw\s+notebook|cw\s+notebook|rough\s+register|activity\s+file|assignment\s+file)\b/gi,
      '**$1**'
    );

    // G. Format Notes / Important alerts
    line = line.replace(
      /^(?:note|nb|important|submission|due date)[:\-\s]+(.*)/i,
      '> ⚠️ **Note:** $1'
    );

    // H. Format Test / Exam mentions
    line = line.replace(
      /\b((?:unit\s*test|ut|periodic\s*test|pt|exam|eval|test)\s*(?:on|of|scheduled)?\s*[^.\n,]*)/gi,
      '📝 **$1**'
    );

    // Clean up duplicate bold syntax if generated (e.g. ****Ch 4****)
    line = line.replace(/\*{4,}/g, '**');

    formattedLines.push(line);
  }

  return formattedLines.join('\n');
}
