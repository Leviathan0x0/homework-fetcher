/** Survives the Requests → Messages view switch so Help / notification context isn't lost. */

export type PendingRequestContext = {
  id: string;
  title: string;
  content: string;
  category?: string | null;
  studentId?: string;
};

export type PendingMessageOpen = {
  /** Open an existing chat by conversation id (notifications, deep links). */
  conversationId?: string;
  /** Start / open a DM with this user id or student id (Help from Requests). */
  targetId?: string;
  /** Draft text for the composer */
  prefill?: string;
  /** Full request so Messages can show a reply reference */
  request?: PendingRequestContext;
};

const KEY = 'pending_message_open_v3';

/** Embedded in message content so the request quote survives refresh. */
const REQUEST_OPEN = '⟦hf-request⟧';
const REQUEST_CLOSE = '⟦/hf-request⟧';

export function setPendingMessageOpen(payload: PendingMessageOpen) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

function parsePending(raw: string): PendingMessageOpen | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const conversationId =
      typeof parsed.conversationId === 'string' && parsed.conversationId
        ? parsed.conversationId
        : undefined;
    const targetId =
      typeof parsed.targetId === 'string' && parsed.targetId ? parsed.targetId : undefined;

    if (!conversationId && !targetId) return null;

    const request =
      parsed.request &&
      typeof parsed.request === 'object' &&
      typeof parsed.request.id === 'string' &&
      typeof parsed.request.title === 'string'
        ? {
            id: parsed.request.id,
            title: String(parsed.request.title),
            content: typeof parsed.request.content === 'string' ? parsed.request.content : '',
            category:
              typeof parsed.request.category === 'string' ? parsed.request.category : null,
            studentId:
              typeof parsed.request.studentId === 'string' ? parsed.request.studentId : undefined,
          }
        : undefined;

    return {
      conversationId,
      targetId,
      prefill: typeof parsed.prefill === 'string' ? parsed.prefill : undefined,
      request,
    };
  } catch {
    return null;
  }
}

export function peekPendingMessageOpen(): PendingMessageOpen | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return parsePending(raw);
  } catch {
    return null;
  }
}

export function clearPendingMessageOpen() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function consumePendingMessageOpen(): PendingMessageOpen | null {
  const pending = peekPendingMessageOpen();
  if (pending) clearPendingMessageOpen();
  return pending;
}

/** Natural first-message draft - request details live in the reply chrome, not the text. */
export function buildHelpPrefill(request: PendingRequestContext): string {
  const title = request.title.trim().replace(/\s+/g, ' ');
  const category = (request.category || '').trim().toLowerCase();

  if (category.includes('note')) {
    return title
      ? `Hey! I can help with “${title}”. Want me to share notes or walk you through it?`
      : `Hey! Happy to help with notes. What do you need?`;
  }
  if (category.includes('homework') || category.includes('hw')) {
    return title
      ? `Hey! Saw your homework request about “${title}”. I can help. Where are you stuck?`
      : `Hey! I can help with the homework. Where are you stuck?`;
  }
  if (title) {
    return `Hey! Saw your request about “${title}”. Happy to help. What do you need?`;
  }
  return `Hey! Happy to help with your request. What do you need?`;
}

export function encodeRequestInMessage(
  request: PendingRequestContext,
  body: string
): string {
  const payload = JSON.stringify({
    id: request.id,
    title: request.title,
    content: request.content.slice(0, 280),
    category: request.category || null,
  });
  const trimmed = body.trim();
  return trimmed
    ? `${REQUEST_OPEN}${payload}${REQUEST_CLOSE}\n${trimmed}`
    : `${REQUEST_OPEN}${payload}${REQUEST_CLOSE}`;
}

export function parseMessageRequestRef(content: string): {
  request: PendingRequestContext | null;
  body: string;
} {
  if (!content || !content.startsWith(REQUEST_OPEN)) {
    return { request: null, body: content || '' };
  }
  const end = content.indexOf(REQUEST_CLOSE);
  if (end < 0) {
    // Older conversation previews were truncated before the closing marker.
    // Never let that internal transport format leak into the inbox. The title
    // normally appears near the start of the JSON, so retain a useful preview
    // when it can be recovered safely.
    const titleMatch = content.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
    let title = '';
    if (titleMatch) {
      try {
        title = JSON.parse(`"${titleMatch[1]}"`);
      } catch {
        title = titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    return {
      request: title ? { id: 'unknown', title, content: '' } : null,
      body: title ? `Help request: ${title}` : 'Help request',
    };
  }

  try {
    const raw = content.slice(REQUEST_OPEN.length, end);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.title !== 'string') {
      const body = content.slice(end + REQUEST_CLOSE.length).replace(/^\n/, '').trim();
      return { request: null, body: body || 'Help request' };
    }
    const request: PendingRequestContext = {
      id: typeof parsed.id === 'string' ? parsed.id : 'unknown',
      title: String(parsed.title),
      content: typeof parsed.content === 'string' ? parsed.content : '',
      category: typeof parsed.category === 'string' ? parsed.category : null,
    };
    const body = content.slice(end + REQUEST_CLOSE.length).replace(/^\n/, '');
    return { request, body };
  } catch {
    const body = content.slice(end + REQUEST_CLOSE.length).replace(/^\n/, '').trim();
    return { request: null, body: body || 'Help request' };
  }
}

/** Preview text without the embedded request marker. */
export function messagePreviewText(content: string, fallback = ''): string {
  const embeddedAt = content.indexOf(REQUEST_OPEN);
  if (embeddedAt > 0) {
    const prefix = content.slice(0, embeddedAt);
    const nested = messagePreviewText(content.slice(embeddedAt), fallback);
    return `${prefix}${nested}`.trim();
  }
  const { request, body } = parseMessageRequestRef(content);
  const trimmed = body.trim();
  if (trimmed) return trimmed;
  if (request?.title) return `Help request: ${request.title}`;
  return fallback;
}
