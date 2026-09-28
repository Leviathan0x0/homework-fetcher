import React from 'react';

/**
 * Prefixes a bare URL must start with before it is turned into a clickable
 * link. Anything else (other schemes, scheme-less domains) stays plain text.
 */
const ALLOWED_LINK_PREFIXES = ['https://', 'http://', 'www.', 'tiny.edusecure.in'] as const;

/** Shared styling so links read as links everywhere they are highlighted. */
export const LINK_CLASS =
  'font-medium underline underline-offset-2 break-all text-sky-600 transition-colors hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300';

export function isAllowedLink(url: string | null | undefined): boolean {
  const value = (url || '').trim().toLowerCase();
  return ALLOWED_LINK_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** Absolute href for an allowed link: scheme-less hosts get https://. */
export function toLinkHref(url: string): string {
  const value = (url || '').trim();
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * Candidate URLs. The match must end on a non-punctuation character, so a
 * sentence like "see https://school.in/page." links without the full stop.
 * `tiny.edusecure.in` is allowed bare because school notices share it that way.
 */
const URL_CANDIDATE_SOURCE =
  '(?:https?:\\/\\/|www\\.)[^\\s<>"\']*[^\\s<>"\'.,;:!?\\]}]' +
  '|tiny\\.edusecure\\.in(?:\\/[^\\s<>"\']*[^\\s<>"\'.,;:!?\\]}])?';

const URL_CANDIDATE_RE = new RegExp(URL_CANDIDATE_SOURCE, 'gi');

/**
 * Splits free-form text into text nodes and anchors, highlighting only the
 * URLs whose prefix is on the allow list.
 */
export function linkifyText(text: string | null | undefined): React.ReactNode[] {
  const value = text || '';
  if (!value) return [];

  const nodes: React.ReactNode[] = [];
  URL_CANDIDATE_RE.lastIndex = 0;

  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_CANDIDATE_RE.exec(value)) !== null) {
    const raw = match[0];
    if (!raw) break;

    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    if (isAllowedLink(raw)) {
      const href = toLinkHref(raw);
      nodes.push(
        <a
          key={`link-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          {raw}
        </a>
      );
    } else {
      nodes.push(raw);
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes;
}
