/**
 * Maps raw API / moderation errors into short, student-friendly copy.
 */
export function friendlyContentError(raw: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const msg = typeof raw === 'string' ? raw : typeof (raw as any)?.message === 'string' ? (raw as any).message : '';
  const lower = msg.toLowerCase();

  if (!msg.trim()) return fallback;

  if (lower.includes('only homework') || lower.includes('unsupported file') || lower.includes('only real homework')) {
    return 'Only homework PDFs and photos (JPG, PNG, or WebP) can be shared here.';
  }
  if (lower.includes("doesn't follow school guidelines") || lower.includes('school guidelines')) {
    return "That message can't be sent — it doesn't follow school guidelines. Keep chats about homework only.";
  }
  if (lower.includes("couldn't be verified") || lower.includes('could not be verified')) {
    return "We couldn't check that photo right now. Please try again in a moment.";
  }
  if (lower.includes('too large') || lower.includes('limited to')) {
    return msg;
  }
  if (lower.includes('too many requests') || lower.includes('slow down')) {
    return 'You are sending too quickly. Please wait a moment and try again.';
  }

  return msg || fallback;
}
