import { LIMITS, TIMEOUTS } from "./config";
import { apiRequest, apiRequestRaw, appendFile, extractSessionCredential } from "./client";
import { ApiError } from "./errors";
import type {
  AppNotification,
  ClassworkResponse,
  Conversation,
  ConversationsResponse,
  CreateConversationResponse,
  HomeworkItem,
  HomeworkResponse,
  LocalFile,
  LoginResponse,
  Message,
  MessagesResponse,
  MeResponse,
  PublicUser,
  RequestStatus,
  RequestsResponse,
  SectionRequest,
  UnreadCountResponse,
  User,
  UserSearchResponse,
} from "./types";

/**
 * Typed endpoint functions.
 *
 * This layer also owns two jobs that keep feature code clean:
 *  - **client-side limit enforcement**, so an oversized or over-long payload is
 *    rejected locally with a specific message instead of round-tripping to a 400.
 *  - **normalisation**, so the small differences between the documented contract
 *    and the deployed server (0/1 integers, missing fields) stop at the boundary.
 */

/* -------------------------------------------------------------------------- */
/* Local validation                                                            */
/* -------------------------------------------------------------------------- */

function rejectLocally(kind: "validation" | "tooLarge", message: string): never {
  throw new ApiError({ kind, message });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Guards the 4 MB ceiling before anything touches the network.
 *
 * Images should already have been through `compressImageForUpload`; this is the
 * backstop that also covers documents, which cannot be compressed.
 */
export function assertUploadable(file: LocalFile): void {
  if (typeof file.size === "number" && file.size > LIMITS.maxUploadBytes) {
    rejectLocally(
      "tooLarge",
      `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(LIMITS.maxUploadBytes)}.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

interface RawHomeworkItem extends Omit<HomeworkItem, "subject" | "completed" | "note" | "updatedAt"> {
  subject?: string | null;
  completed?: boolean | number | null;
  note?: string | null;
  updatedAt?: string | null;
}

function normalizeHomework(item: RawHomeworkItem): HomeworkItem {
  return {
    id: item.id,
    type: item.type,
    date: item.date,
    subject: item.subject ?? null,
    homework: item.homework,
    attachment: item.attachment ?? null,
    completed: item.completed === true || item.completed === 1,
    note: item.note ?? null,
    updatedAt: item.updatedAt ?? null,
  };
}

interface RawNotification extends Omit<AppNotification, "isRead" | "body" | "link" | "referenceId"> {
  isRead: boolean | number;
  body?: string | null;
  link?: string | null;
  referenceId?: string | null;
}

function normalizeNotification(item: RawNotification): AppNotification {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body ?? null,
    link: item.link ?? null,
    referenceId: item.referenceId ?? null,
    // The server stores this as an integer; the app only ever sees a boolean.
    isRead: item.isRead === true || item.isRead === 1,
    createdAt: item.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export interface LoginResult {
  user: User;
  /** Opaque credential to persist via `setSessionToken`. */
  credential: string;
}

/**
 * Signs in.
 *
 * Sent anonymously and with the global 401 redirect suppressed: a rejected login
 * is an inline form error, not a sign-out event. The distinction between a wrong
 * password (401) and an unreachable school portal (502) is preserved by
 * `kindFromStatus`, which is what lets the login screen show different copy.
 */
export async function login(studentId: string, password: string): Promise<LoginResult> {
  const trimmedId = studentId.trim();
  if (!trimmedId) rejectLocally("validation", "Enter your student ID.");
  if (!password) rejectLocally("validation", "Enter your password.");

  const { data, response } = await apiRequestRaw<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { studentId: trimmedId, password },
    anonymous: true,
    ignoreUnauthorized: true,
    // The portal login can be slow; give it more room than a normal request.
    timeoutMs: TIMEOUTS.slowRefresh,
  });

  if (!data.authenticated || !data.user) {
    throw new ApiError({ kind: "invalidCredentials", message: data.error ?? "Sign in failed." });
  }

  return { user: data.user, credential: extractSessionCredential(response, data) };
}

/**
 * Loads the signed-in user.
 *
 * The server answers `200 {authenticated: false}` rather than a 401 when the
 * session is gone, so that case is converted into a real `unauthorized` error to
 * keep one code path for "session ended".
 */
export async function fetchMe(): Promise<User> {
  const data = await apiRequest<MeResponse>("/api/auth/me", { ignoreUnauthorized: true });
  if (!data.authenticated || !data.user) {
    throw new ApiError({ kind: "unauthorized", message: "Session is no longer valid." });
  }
  return data.user;
}

/**
 * Updates the display name other students see instead of the raw student ID.
 *
 * The server enforces 2–40 characters after collapsing whitespace, so the same
 * normalisation happens here — otherwise "  A  B  " passes locally and is
 * rejected remotely for a reason the user cannot see.
 */
export async function updateDisplayName(displayName: string): Promise<User> {
  const cleaned = displayName.trim().replace(/\s+/g, " ");
  if (cleaned.length < LIMITS.minDisplayNameChars || cleaned.length > LIMITS.maxDisplayNameChars) {
    rejectLocally(
      "validation",
      `Your name must be between ${LIMITS.minDisplayNameChars} and ${LIMITS.maxDisplayNameChars} characters.`,
    );
  }

  const data = await apiRequest<{ success: boolean; user: User }>("/api/auth/profile", {
    method: "PATCH",
    body: { displayName: cleaned },
  });
  return data.user;
}

/** Configuration diagnostics. Used to tell "API down" from "wrong address". */
export async function checkHealth(): Promise<boolean> {
  try {
    await apiRequest<unknown>("/api/health", { anonymous: true, ignoreUnauthorized: true, timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Best-effort server-side sign out. The local credential is cleared regardless. */
export async function logout(): Promise<void> {
  try {
    await apiRequest<{ success: boolean }>("/api/auth/logout", { method: "POST", ignoreUnauthorized: true });
  } catch {
    // An already-dead session, or no network. Either way the client-side clear in
    // the auth provider is the part that matters.
  }
}

/* -------------------------------------------------------------------------- */
/* Homework                                                                    */
/* -------------------------------------------------------------------------- */

export interface HomeworkResult {
  items: HomeworkItem[];
  isStale: boolean;
  /** Cached rows are being served because the school session died. */
  sessionExpired: boolean;
  warning: string | null;
}

export async function fetchHomework(): Promise<HomeworkResult> {
  const data = await apiRequest<HomeworkResponse & { homework: RawHomeworkItem[] }>("/api/homework");
  return {
    items: (data.homework ?? []).map(normalizeHomework),
    isStale: data.isStale === true,
    sessionExpired: data.sessionExpired === true,
    warning: data.warning ?? data.error ?? null,
  };
}

/** Forces a re-scrape of the school portal. Slow by nature — up to ~15s. */
export async function refreshHomework(): Promise<HomeworkResult> {
  const data = await apiRequest<HomeworkResponse & { homework: RawHomeworkItem[] }>("/api/homework/refresh", {
    method: "POST",
    timeoutMs: TIMEOUTS.slowRefresh,
  });
  return {
    items: (data.homework ?? []).map(normalizeHomework),
    isStale: false,
    sessionExpired: false,
    warning: data.warning ?? null,
  };
}

export async function setHomeworkCompleted(id: string, completed: boolean): Promise<void> {
  await apiRequest<{ success: boolean }>(`/api/homework/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: { completed },
  });
}

export async function setHomeworkNote(id: string, note: string | null): Promise<void> {
  const cleaned = note?.trim() ?? "";
  await apiRequest<{ success: boolean }>(`/api/homework/${encodeURIComponent(id)}/note`, {
    method: "PATCH",
    body: { note: cleaned.length > 0 ? cleaned : null },
  });
}

/* -------------------------------------------------------------------------- */
/* Classwork                                                                   */
/* -------------------------------------------------------------------------- */

export async function fetchClasswork(): Promise<ClassworkResponse> {
  const data = await apiRequest<ClassworkResponse>("/api/classwork");
  return { section: data.section ?? null, count: data.count ?? 0, classwork: data.classwork ?? [] };
}

export interface UploadClassworkInput {
  file: LocalFile;
  subject: string;
  title?: string;
  /** `YYYY-MM-DD`. Defaults server-side to today when omitted. */
  date?: string;
}

export async function uploadClasswork(input: UploadClassworkInput): Promise<void> {
  if (!input.subject.trim()) rejectLocally("validation", "Pick a subject for this upload.");
  assertUploadable(input.file);

  const form = new FormData();
  appendFile(form, "file", input.file);
  form.append("subject", input.subject.trim());
  if (input.title?.trim()) form.append("title", input.title.trim());
  if (input.date) form.append("date", input.date);

  await apiRequest<{ success: boolean }>("/api/classwork", { method: "POST", form });
}

export async function deleteClasswork(id: string): Promise<void> {
  await apiRequest<{ success: boolean }>(`/api/classwork/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchRequests(): Promise<RequestsResponse> {
  const data = await apiRequest<RequestsResponse>("/api/requests");
  return { section: data.section ?? null, count: data.count ?? 0, requests: data.requests ?? [] };
}

export interface CreateRequestInput {
  title: string;
  content: string;
  category: string;
}

export async function createRequest(input: CreateRequestInput): Promise<SectionRequest> {
  const title = input.title.trim();
  const content = input.content.trim();

  if (!title) rejectLocally("validation", "Give your request a title.");
  if (title.length > LIMITS.maxRequestTitleChars) {
    rejectLocally("validation", `Titles are limited to ${LIMITS.maxRequestTitleChars} characters.`);
  }
  if (!content) rejectLocally("validation", "Add some details so people know how to help.");
  if (content.length > LIMITS.maxRequestDetailsChars) {
    rejectLocally("validation", `Details are limited to ${LIMITS.maxRequestDetailsChars} characters.`);
  }

  const data = await apiRequest<{ request: SectionRequest }>("/api/requests", {
    method: "POST",
    body: { title, content, category: input.category },
  });
  return data.request;
}

export async function setRequestStatus(id: string, status: RequestStatus): Promise<void> {
  await apiRequest<{ success: boolean }>(`/api/requests/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: { status },
  });
}

export async function deleteRequest(id: string): Promise<void> {
  await apiRequest<{ success: boolean }>(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* Messaging                                                                   */
/* -------------------------------------------------------------------------- */

export async function searchUsers(query: string, signal?: AbortSignal): Promise<PublicUser[]> {
  const trimmed = query.trim().slice(0, LIMITS.maxSearchQueryChars);
  if (!trimmed) return [];
  const data = await apiRequest<UserSearchResponse>("/api/users/search", {
    query: { q: trimmed },
    signal,
  });
  return data.users ?? [];
}

export async function fetchConversations(): Promise<Conversation[]> {
  const data = await apiRequest<ConversationsResponse>("/api/conversations");
  return (data.conversations ?? []).map((conversation) => ({
    ...conversation,
    lastMessagePreview: conversation.lastMessagePreview ?? null,
    lastMessageAt: conversation.lastMessageAt ?? null,
    unreadCount: conversation.unreadCount ?? 0,
  }));
}

export async function createConversation(participantId: string): Promise<CreateConversationResponse> {
  return apiRequest<CreateConversationResponse>("/api/conversations", {
    method: "POST",
    body: { participantId },
  });
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const data = await apiRequest<MessagesResponse>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  return data.messages ?? [];
}

export interface SendMessageInput {
  conversationId: string;
  content?: string;
  file?: LocalFile;
}

/**
 * Sends a message.
 *
 * At least one of `content` / `file` is required by the server, so that is
 * checked here too. A 429 from the rate limiter surfaces as
 * `kind: "rateLimited"` carrying `retryAfterSeconds`, which the composer shows
 * inline while keeping the draft.
 */
export async function sendMessage(input: SendMessageInput): Promise<Message> {
  const content = input.content?.trim() ?? "";

  if (!content && !input.file) {
    rejectLocally("validation", "Write a message or attach a file.");
  }
  if (content.length > LIMITS.maxMessageChars) {
    rejectLocally("validation", `Messages are limited to ${LIMITS.maxMessageChars} characters.`);
  }
  if (input.file) assertUploadable(input.file);

  const form = new FormData();
  if (content) form.append("content", content);
  if (input.file) appendFile(form, "file", input.file);

  const data = await apiRequest<{ success: boolean; message: Message }>(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    { method: "POST", form },
  );
  return data.message;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await apiRequest<{ success: boolean }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/read`,
    { method: "PATCH" },
  );
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export async function fetchNotifications(): Promise<AppNotification[]> {
  const data = await apiRequest<{ notifications: RawNotification[] }>("/api/notifications");
  return (data.notifications ?? []).map(normalizeNotification);
}

export async function fetchUnreadCount(): Promise<number> {
  const data = await apiRequest<UnreadCountResponse>("/api/notifications/unread-count");
  return data.count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiRequest<{ success: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiRequest<{ success: boolean }>("/api/notifications/read-all", { method: "POST" });
}
