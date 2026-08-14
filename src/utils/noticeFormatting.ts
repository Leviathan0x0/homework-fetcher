const SPECIAL_NOTICE_LINES = [
  /^(\s*)(?:\*{1,2}\s*)?(Dear\s+(?:Students?|Parents?)\s*[,;:]?)(?:\s*\*{1,2})?(?=\s|$)(.*)$/i,
  /^(\s*)(?:\*{1,2}\s*)?(Team\s+manav\s+mangal(?:\s*-\s*[a-z0-9]+)?\s*[.,;:]?)(?:\s*\*{1,2})?(?=\s|$)(.*)$/i,
];

/**
 * Restores emphasis for the standard greeting and school signature lines.
 * The portal is inconsistent about case, punctuation, whitespace, and stray
 * opening Markdown markers, so normalising the shape is safer than listing
 * every spelling separately.
 */
export function formatNoticeContent(content: string): string {
  if (!content) return '';

  return content
    .split('\n')
    .map((line) => {
      for (const pattern of SPECIAL_NOTICE_LINES) {
        const match = line.match(pattern);
        if (!match) continue;

        const [, indentation, phrase, remainder] = match;
        return `${indentation}**${phrase.trim()}**${remainder || ''}`;
      }
      return line;
    })
    .join('\n');
}
