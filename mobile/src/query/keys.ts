/**
 * Query keys.
 *
 * Centralised so invalidation is never a guess. The first element doubles as the
 * persistence root — see `PERSISTED_ROOTS` in `persist.ts`.
 */
export const queryKeys = {
  me: ["me"] as const,
  homework: ["homework"] as const,
  classwork: ["classwork"] as const,
  requests: ["requests"] as const,
  conversations: ["conversations"] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  userSearch: (term: string) => ["userSearch", term] as const,
  notifications: ["notifications"] as const,
  unreadCount: ["unreadCount"] as const,
} as const;
