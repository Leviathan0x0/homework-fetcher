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
  /** Full request so Messages can show a reference card */
  request?: PendingRequestContext;
};

const KEY = 'pending_message_open_v3';

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

/** Build a useful first-message draft that quotes the request. */
export function buildHelpPrefill(request: PendingRequestContext): string {
  const title = request.title.trim();
  const body = request.content.trim();
  const quote =
    body.length > 280 ? `${body.slice(0, 277).trimEnd()}…` : body;
  const lines = [`Re: ${title}`];
  if (quote) {
    lines.push('', quote);
  }
  lines.push('', 'I can help — ');
  return lines.join('\n');
}
