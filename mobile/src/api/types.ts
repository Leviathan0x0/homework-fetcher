/**
 * Types for the existing Express API.
 *
 * These mirror what the server in `server/routes/*.js` actually returns, not an
 * idealised contract. Where the two differ, the difference is called out in a
 * comment and reconciled in `endpoints.ts` so screens see one clean shape.
 */

export interface User {
  id: string;
  studentId: string;
  displayName: string | null;
  /** Null until the school profile scrape has resolved a section. */
  section: string | null;
}

/**
 * A user as returned by search and conversation payloads.
 *
 * `name` is the server's own precomputed `displayName || studentId`. Prefer
 * `displayName || studentId` in the UI and never show `studentId` as the primary
 * label when a display name exists.
 */
export interface PublicUser {
  id: string;
  studentId: string;
  displayName: string | null;
  name: string;
  section: string | null;
}

export interface LoginResponse {
  authenticated: boolean;
  /**
   * Present only if the API is upgraded to bearer tokens. The deployed server
   * authenticates with the `app_session` cookie, which the client captures from
   * `Set-Cookie` instead. See `extractSessionToken` in `client.ts`.
   */
  token?: string;
  user: User;
  error?: string;
}

export interface MeResponse {
  authenticated: boolean;
  user?: User;
}

export interface HomeworkItem {
  id: string;
  /** Free-form category from the school portal, e.g. "Homework", "Exam". */
  type: string;
  /** `YYYY-MM-DD`. */
  date: string;
  subject: string | null;
  /** The assignment body. May contain light markup from the portal. */
  homework: string;
  attachment: string | null;
  completed: boolean;
  note: string | null;
  updatedAt: string | null;
}

export interface HomeworkResponse {
  count: number;
  homework: HomeworkItem[];
  /** Cache is older than the freshness window; a refresh is worthwhile. */
  isStale?: boolean;
  isRefreshing?: boolean;
  /** School portal session died; cached rows are being served. */
  sessionExpired?: boolean;
  warning?: string;
  error?: string;
  code?: string;
}

export interface ClassworkItem {
  id: string;
  studentId: string;
  section: string | null;
  subject: string;
  title: string | null;
  date: string | null;
  /** Server-relative, e.g. `/api/classwork/files/<id>`. Requires the auth header. */
  fileUrl: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  isOwner: boolean;
}

export interface ClassworkResponse {
  section: string | null;
  count: number;
  classwork: ClassworkItem[];
}

export type RequestStatus = "open" | "completed";

export interface SectionRequest {
  id: string;
  studentId: string;
  section: string;
  category: string | null;
  title: string;
  content: string;
  status: RequestStatus;
  createdAt: string;
  creatorUserId: string;
  isOwner: boolean;
}

export interface RequestsResponse {
  section: string | null;
  count: number;
  requests: SectionRequest[];
}

export interface Conversation {
  id: string;
  /** Null if the counterpart account was removed. Render a placeholder row. */
  otherUser: PublicUser | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  /**
   * Not sent by the current server. Resolved from the conversation's `otherUser`
   * (or the signed-in user) in the chat screen.
   */
  senderName?: string;
  content: string;
  attachmentUrl: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  createdAt: string;
  isMine: boolean;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface CreateConversationResponse {
  conversationId: string;
  otherUser: PublicUser | null;
}

export interface UserSearchResponse {
  users: PublicUser[];
}

export type NotificationType = "new_message" | "new_request" | "new_classwork" | (string & {});

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /**
   * Either `messages:<conversationId>` or a bare view name such as `requests`.
   * Parsed by `parseNotificationLink` in `src/features/notifications/link.ts`.
   */
  link: string | null;
  referenceId: string | null;
  /** Normalised from the server's 0/1 integer to a boolean in `endpoints.ts`. */
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
}

export interface UnreadCountResponse {
  count: number;
}

/** A file selected on device, in the shape React Native's FormData expects. */
export interface LocalFile {
  uri: string;
  name: string;
  /** MIME type. Required — the server validates it. */
  type: string;
  /** Byte size when known, so the 4 MB limit can be enforced before upload. */
  size?: number;
}
