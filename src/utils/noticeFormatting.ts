const SPECIAL_NOTICE_LINES = [
  /^(\s*)(?:\*{1,2}\s*)?(Dear\s+(?:Students?|Parents?)\s*[,;:]?)(?:\s*\*{1,2})?(?=\s|$)(.*)$/i,
  /^(\s*)(?:\*{1,2}\s*)?(Team\s+manav\s+mangal(?:\s*-\s*[a-z0-9]+)?\s*[.,;:]?)(?:\s*\*{1,2})?(?=\s|$)(.*)$/i,
  /^(\s*)(?:\*{1,2}\s*)?(manav\s+mangal\s+smart\s+school\s*[.,;:]?)(?:\s*\*{1,2})?(?=\s|$)(.*)$/i,
];

/**
 * Restores emphasis for the standard greeting and school signature lines.
 * Normalizes shapes like "Dear Parent,", "Team manav mangal", etc.
 */
export function formatNoticeContent(content: string): string {
  if (!content) return '';

  return content
    .split('\n')
    .map((line) => {
      let result = line;
      for (const pattern of SPECIAL_NOTICE_LINES) {
        const match = result.match(pattern);
        if (match) {
          const [, indentation, phrase, remainder] = match;
          return `${indentation}**${phrase.trim()}**${remainder || ''}`;
        }
      }
      result = result.replace(/(?<!\*)\b(Dear\s+(?:Students?|Parents?)\s*[,;:]?)(?!\*)/gi, '**$1**');
      result = result.replace(/(?<!\*)\b(Team\s+manav\s+mangal(?:\s*-\s*[a-z0-9]+)?\s*[.,;:]?)(?!\*)/gi, '**$1**');
      return result;
    })
    .join('\n');
}
