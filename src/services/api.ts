import { apiFetch, apiJson, apiUrl } from "../lib/api";
import { messagePreviewText, parseMessageRequestRef } from "../utils/pendingMessageOpen";
import { getHomeworkRequest } from "./homeworkLoader";

/**
 * Conversations from the last successful load.
 * The Messages tab renders this cache immediately instead of waiting a full
 * round trip before the inbox has anything to show. It is dropped on login and
 * logout so it can only ever belong to the signed-in account.
 */
const CONVERSATIONS_CACHE_KEY = "cachedConversations";

function readConversationCache(): any[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((conversation: any) => ({
      ...conversation,
      lastMessagePreview: conversation?.lastMessagePreview
        ? messagePreviewText(String(conversation.lastMessagePreview), 'Help request')
        : conversation?.lastMessagePreview,
    }));
  } catch {
    return [];
  }
}

function writeConversationCache(conversations: any[]) {
  try {
    localStorage.setItem(CONVERSATIONS_CACHE_KEY, JSON.stringify(conversations));
  } catch {}
}

function clearConversationCache() {
  try {
    localStorage.removeItem(CONVERSATIONS_CACHE_KEY);
  } catch {}
}

function mapAuthUser(user: any) {
  const section = user?.section;
  const isAdmin = Boolean(
    user?.isAdmin ||
      user?.role === "admin" ||
      user?.studentId === "admin_mmss" ||
      section === "Admin"
  );
  const unknown =
    !isAdmin &&
    (!section ||
      String(section).trim() === "" ||
      String(section).trim().toLowerCase() === "section 10-a");
  return {
    id: user.id,
    studentId: user.studentId,
    displayName: user.displayName || null,
    profilePictureUrl: user.profilePictureUrl || null,
    section: unknown ? null : section,
    isAdmin,
    isTeacher: Boolean(user?.isTeacher || user?.role === "teacher" || user?.role === "class_teacher"),
    role: user.role || (isAdmin ? "admin" : "student"),
    teacherProfile: user?.teacherProfile || null,
  };
}

const SESSION_CHECK_TIMEOUT_MS = 6_000;
let currentUserRequest: Promise<ReturnType<typeof mapAuthUser> | null> | null = null;

// --- AUTH SERVICE ---
export const authService = {
  getCurrentUser() {
    if (currentUserRequest) return currentUserRequest;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SESSION_CHECK_TIMEOUT_MS);
    currentUserRequest = (async () => {
      const res = await apiFetch("/api/auth/me", {
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Session validation failed (${res.status}).`);
      const data = await apiJson<any>(res);
      if (!data.authenticated || !data.user) return null;
      return mapAuthUser(data.user);
    })().finally(() => {
      window.clearTimeout(timeout);
      currentUserRequest = null;
    });
    return currentUserRequest;
  },

  async login(studentId: string, pass: string, _chosenSection?: string) {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ studentId: studentId.trim(), password: pass })
    });

    const data = await apiJson<any>(res);
    if (!res.ok || !data.authenticated) {
      const msg = typeof data.error === "string" ? data.error : (data.error?.message || data.message || "");
      // The server's own wording is always more specific than a status-code
      // guess: a 503 can mean the API is unconfigured, but it can equally mean
      // a named account is switched off, and replacing that with "try again in
      // a moment" sends people to wait for something that will never change.
      if (msg) throw new Error(msg);
      if (res.status === 503) {
        throw new Error("The school portal service is temporarily unavailable. Please try again in a moment.");
      }
      throw new Error("Invalid student ID or password.");
    }

    // A new session must never read the previous account's cached conversations.
    clearConversationCache();

    return mapAuthUser(data.user);
  },

  /** Saves the name other students see instead of the raw student ID. */
  async updateDisplayName(displayName: string) {
    const res = await apiFetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ displayName }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.user) throw new Error(data.error || "Failed to save your name.");
    return mapAuthUser(data.user);
  },
  async uploadProfilePicture(file: File) {
    const formData = new FormData();
    formData.append("picture", file);
    const res = await apiFetch("/api/auth/profile/picture", {
      method: "POST",
      body: formData,
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Could not save your profile picture.");
    }
    return data.profilePictureUrl as string | null;
  },
  async deleteProfilePicture() {
    const res = await apiFetch("/api/auth/profile/picture", { method: "DELETE" });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Could not remove your profile picture.");
    }
    return null;
  },

  /**
   * Renews the school-portal session without signing out of the app.
   * The password is never stored, so the school portal has to be given it
   * again whenever its own (much shorter) session lapses.
   */
  async reconnectSchool(password: string) {
    const res = await apiFetch("/api/auth/reconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Could not reconnect to the school portal.");
    }
    return true;
  },

  async logout() {
    try {
      await apiFetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      clearConversationCache();
    }
  }
};

// --- HOMEWORK SERVICE ---
export const homeworkService = {
  async getHomework(userId: string, forceRefresh = false) {
    const request = getHomeworkRequest(forceRefresh);
    const res = await apiFetch(request.path, request.options);
    if (!res.ok) {
      const errData = await apiJson<any>(res).catch(() => ({} as any));
      const error: any = new Error(errData.message || errData.error || "Failed to fetch homework.");
      error.code = errData.code || (res.status === 401 ? "UNAUTHENTICATED" : undefined);
      throw error;
    }
    const data = await apiJson<any>(res);
    const rawList = data.homework || [];
    const seen = new Set<string>();
    const deduplicated: any[] = [];

    for (const doc of rawList) {
      if (!doc) continue;
      const text = (doc.homework || doc.content || "").trim();
      const key = `${(doc.date || "").trim()}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduplicated.push({
        id: doc.id,
        type: doc.type || "School Diary",
        date: doc.date || "",
        subject: doc.subject || "School Diary",
        homework: text,
        attachment: doc.attachment || doc.attachmentUrl || null,
        completed: !!doc.completed,
        note: doc.note || null,
        updatedAt: doc.updatedAt,
      });
    }
    // The school session can be dead while cached homework still renders, so
    // the flag travels with the list rather than only as an error.
    return {
      items: deduplicated,
      schoolSessionExpired: Boolean(data.schoolSessionExpired),
      isStale: data.isStale === true,
    };
  },

  async toggleCompleted(userId: string, homeworkId: string, completed: boolean) {
    const res = await apiFetch(`/api/homework/${encodeURIComponent(homeworkId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ completed })
    });
    if (!res.ok) {
      throw new Error("Failed to update completion status.");
    }
  },

  async updateNote(userId: string, homeworkId: string, note: string | null) {
    const res = await apiFetch(`/api/homework/${encodeURIComponent(homeworkId)}/note`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ note })
    });
    if (!res.ok) {
      throw new Error("Failed to update note.");
    }
  }
};

// --- SCHOOL CALENDAR (holidays / events from EduSecure) ---
export const calendarService = {
  async getEvents() {
    const res = await apiFetch("/api/calendar", { headers: { Accept: "application/json" } });
    const data = await apiJson<any>(res);
    if (!res.ok) {
      throw new Error(data.error || "Failed to load school calendar.");
    }
    return Array.isArray(data.events) ? data.events : [];
  },

  async refresh() {
    const res = await apiFetch("/api/calendar/refresh", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const data = await apiJson<any>(res);
    if (!res.ok && (!data.events || data.events.length === 0)) {
      throw new Error(data.error || "Failed to refresh school calendar.");
    }
    return Array.isArray(data.events) ? data.events : [];
  },

  async setSelected(eventId: string, selected: boolean) {
    const res = await apiFetch(`/api/calendar/${encodeURIComponent(eventId)}/selected`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ selected }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to update holiday.");
    return data.event;
  },
};

// --- SCHOOL UPDATES (EduSecure circulars and important messages) ---
export const schoolNoticeService = {
  async getNotices(kind: "circulars" | "important", forceRefresh = false) {
    const suffix = forceRefresh ? "/refresh" : "";
    const res = await apiFetch(`/api/school-updates/${kind}${suffix}`, {
      method: forceRefresh ? "POST" : "GET",
      headers: { Accept: "application/json" },
    });
    const data = await apiJson<any>(res);
    if (!res.ok) {
      const error = new Error(data.error || "Failed to load school updates.") as Error & {
        code?: string;
      };
      error.code = data.code;
      throw error;
    }
    const notices = Array.isArray(data.notices) ? data.notices : [];
    return notices.map((notice: any) => {
      const attachments = Array.isArray(notice.attachments)
        ? notice.attachments.map((attachment: any) => ({
            ...attachment,
            url: attachment?.url ? apiUrl(attachment.url) : attachment?.url,
          }))
        : [];
      return {
        ...notice,
        attachments,
        attachment: notice.attachment
          ? apiUrl(notice.attachment)
          : attachments[0]?.url || null,
      };
    });
  },
};

// --- MESSAGING SERVICE ---
/** Maps an API message payload to the UI message shape. */
function mapMessage(raw: any) {
  const content = raw.content || "";
  const { request, body } = parseMessageRequestRef(content);
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    senderId: raw.senderId,
    senderStudentId: undefined,
    senderName: raw.senderName || null,
    senderProfilePictureUrl: raw.senderProfilePictureUrl || null,
    content,
    displayContent: body,
    requestRef: request,
    attachmentUrl: raw.attachmentUrl ? apiUrl(raw.attachmentUrl) : null,
    originalFilename: raw.originalFilename || null,
    mimeType: raw.mimeType || null,
    replyTo: raw.replyTo
      ? {
          ...raw.replyTo,
          content: messagePreviewText(String(raw.replyTo.content || ''), 'Help request'),
        }
      : null,
    readBy: raw.readBy || [],
    createdAt: raw.createdAt,
    isMine: !!raw.isMine,
  };
}

export const messagingService = {
  async searchUsers(query: string, _currentStudentId?: string) {
    if (!query.trim()) return [];
    const res = await apiFetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await apiJson<any>(res);
    return data.users || [];
  },

  /** Ensures a student ID has an app account so a DM can start before they log in. */
  async resolveUser(studentId: string) {
    const res = await apiFetch("/api/users/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ studentId }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.user) {
      throw new Error(data.error || "Could not look up that student ID.");
    }
    return data.user as {
      id: string;
      studentId: string;
      displayName?: string | null;
      name?: string;
      section?: string;
    };
  },

  /** Conversations stored by the previous load, available synchronously. */
  getCachedConversations() {
    return readConversationCache();
  },

  async getConversations(_currentStudentId?: string) {
    const res = await apiFetch("/api/conversations", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Failed to load conversations.");
    const data = await apiJson<any>(res);
    const conversations = (data.conversations || []).map((c: any) => ({
      ...c,
      lastMessagePreview: c.lastMessagePreview
        ? messagePreviewText(String(c.lastMessagePreview), String(c.lastMessagePreview))
        : c.lastMessagePreview,
      pinnedHomework: c.pinnedHomework
        ? {
            ...c.pinnedHomework,
            attachmentUrl: c.pinnedHomework.attachmentUrl
              ? apiUrl(c.pinnedHomework.attachmentUrl)
              : c.pinnedHomework.attachmentUrl,
          }
        : null,
    }));
    writeConversationCache(conversations);
    return conversations;
  },

  async deleteConversation(convId: string) {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}`, { method: "DELETE" });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to delete conversation.");
    writeConversationCache(readConversationCache().filter((c: any) => c.id !== convId));
  },

  async leaveConversation(convId: string) {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/leave`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to remove group from your chat list.");
    writeConversationCache(readConversationCache().filter((c: any) => c.id !== convId));
  },

  async deleteMessage(messageId: string) {
    const res = await apiFetch(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to delete message.");
  },

  async reportConversation(convId: string, reason?: string) {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ reason: reason || "" }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Could not submit the report.");
    return data;
  },

  async getMessages(convId: string, signal?: AbortSignal, after?: string | null) {
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/messages${query}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) throw new Error("Failed to load messages.");
    const data = await apiJson<any>(res);
    return (data.messages || []).map(mapMessage);
  },

  async sendMessage(
    convId: string,
    _senderStudentId: string,
    content: string,
    file?: File | null,
    replyToId?: string | null
  ) {
    const formData = new FormData();
    if (content) formData.append("content", content);
    if (file) formData.append("file", file);
    if (replyToId) formData.append("replyToId", replyToId);

    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.message) {
      throw new Error(data.error || "Failed to send message.");
    }
    return mapMessage(data.message);
  },

  async startConversation(_currentStudentId: string, participantId: string, noticeToken?: string | null) {
    const res = await apiFetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        participantId,
        ...(noticeToken ? { noticeToken } : {}),
      }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.conversationId) {
      const err = new Error(data.error || "Failed to start conversation.") as Error & {
        needsNotice?: boolean;
      };
      err.needsNotice = !!data.needsNotice;
      throw err;
    }
    return { conversationId: data.conversationId, otherUser: data.otherUser || null, existing: !!data.existing, type: data.type || "dm" };
  },

  async markAsRead(convId: string) {
    await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/read`, { method: "PATCH" }).catch(() => {});
  },

  async markMessageRead(messageId: string) {
    await apiFetch(`/api/messages/${encodeURIComponent(messageId)}/read`, { method: "POST" }).catch(() => {});
  },

  async muteConversation(convId: string, muted: boolean) {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/mute`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ muted }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to update mute status.");
    return data;
  },

  async pinHomework(convId: string, homeworkId: string | null) {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/pin-homework`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ homeworkId }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to pin homework.");
    return {
      pinnedHomeworkId: data.pinnedHomeworkId || null,
      pinnedHomework: data.pinnedHomework
        ? {
            ...data.pinnedHomework,
            attachmentUrl: data.pinnedHomework.attachmentUrl
              ? apiUrl(data.pinnedHomework.attachmentUrl)
              : data.pinnedHomework.attachmentUrl,
          }
        : null,
    };
  },

  async createSectionConversation() {
    const res = await apiFetch("/api/conversations/section", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.conversationId) {
      throw new Error(data.error || "Failed to open class group.");
    }
    return { conversationId: data.conversationId, section: data.section || null };
  },

  /** Classmates in the signed-in student's section (IDs stay server-side). */
  async getSectionMembers() {
    const res = await apiFetch("/api/section/members", { headers: { Accept: "application/json" } });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to load classmates.");
    return {
      section: (data.section as string | null) || null,
      members: (Array.isArray(data.members) ? data.members : []) as Array<{
        id: string;
        studentId: string;
        displayName?: string | null;
        section?: string | null;
      }>,
    };
  },

  /**
   * Polls a conversation for messages the client has not seen yet.
   * Returns an unsubscribe function, mirroring a realtime subscription.
   */
  subscribeToMessages(convId: string, onMessageReceived: (message: any) => void, intervalMs = 2000) {
    let stopped = false;
    const seen = new Set<string>();
    let primed = false;

    const poll = async () => {
      try {
        const messages = await this.getMessages(convId);
        for (const message of messages) {
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          if (primed && !message.isMine) onMessageReceived(message);
        }
        primed = true;
      } catch {}
    };

    poll();
    const timer = setInterval(() => {
      if (!stopped) poll();
    }, intervalMs);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  },
};

// --- NOTIFICATION SERVICE ---
export const notificationService = {
  async getNotifications(_userId?: string) {
    const res = await apiFetch("/api/notifications", { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await apiJson<any>(res);
    return data.notifications || [];
  },

  async getUnreadCount() {
    const res = await apiFetch("/api/notifications/unread-count", { headers: { Accept: "application/json" } });
    if (!res.ok) return 0;
    const data = await apiJson<any>(res);
    return data.count || 0;
  },

  async markAsRead(id: string) {
    await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
  },

  async markAllAsRead(_userId?: string) {
    await apiFetch("/api/notifications/read-all", { method: "POST" });
  },
};

// --- REQUEST SERVICE ---
export const requestService = {
  async getRequests(_section?: string) {
    const res = await apiFetch("/api/requests", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Failed to load requests.");
    const data = await apiJson<any>(res);
    return data.requests || [];
  },

  async createRequest(title: string, content: string, category?: string) {
    const res = await apiFetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title, content, category }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.request) throw new Error(data.error || "Failed to create request.");
    return data.request;
  },

  async markSeen(requestIds?: string[]) {
    const res = await apiFetch("/api/requests/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(requestIds?.length ? { requestIds } : {}),
    });
    if (!res.ok) throw new Error("Failed to acknowledge requests.");
  },

  async updateStatus(id: string, status: string) {
    const res = await apiFetch(`/api/requests/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to update request.");
  },

  async deleteRequest(id: string) {
    const res = await apiFetch(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete request.");
  },
};

// --- CLASSWORK SERVICE ---
export const classworkService = {
  async getClasswork(_section?: string) {
    const res = await apiFetch("/api/classwork", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Failed to load classwork.");
    const data = await apiJson<any>(res);
    return (data.classwork || []).map((item: any) => ({
      ...item,
      fileUrl: item.fileUrl ? apiUrl(item.fileUrl) : item.fileUrl,
    }));
  },

  async uploadClasswork(file: File, subject: string, title?: string, _section?: string, date?: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("subject", subject);
    if (title) formData.append("title", title);
    if (date) formData.append("date", date);

    const res = await apiFetch("/api/classwork", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.classwork) throw new Error(data.error || "Upload failed.");
    return {
      ...data.classwork,
      fileUrl: data.classwork.fileUrl ? apiUrl(data.classwork.fileUrl) : data.classwork.fileUrl,
    };
  },

  async deleteClasswork(id: string, _fileId?: string) {
    const res = await apiFetch(`/api/classwork/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete classwork.");
  },
};

// --- ADMIN SERVICE ---
async function adminJson<T>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await apiJson<any>(res);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (typeof data?.error === "string" && data.error) ||
      data?.message ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const adminService = {
  async getStats() {
    const res = await apiFetch("/api/admin/stats");
    return adminJson<{ stats: any }>(res);
  },
  async getStudents() {
    const res = await apiFetch("/api/admin/students");
    return adminJson<{ students: any[] }>(res);
  },
  async muteStudent(studentId: string, mute: boolean, reason?: string) {
    const res = await apiFetch("/api/admin/students/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, mute, reason }),
    });
    return adminJson<any>(res);
  },
  async getTeachers() {
    const res = await apiFetch("/api/admin/teachers");
    return adminJson<{ teachers: any[] }>(res);
  },
  async getAlerts() {
    const res = await apiFetch("/api/admin/alerts");
    return adminJson<{ alerts: any[] }>(res);
  },
  async createAlert(data: { title: string; message: string; level?: string; targetSection?: string }) {
    const res = await apiFetch("/api/admin/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return adminJson<{ success: boolean; alert: any }>(res);
  },
  async deleteAlert(id: string) {
    const res = await apiFetch(`/api/admin/alerts/${id}`, { method: "DELETE" });
    return adminJson<any>(res);
  },
  async getReports() {
    const res = await apiFetch("/api/admin/reports");
    return adminJson<{ reports: any[] }>(res);
  },
  async resolveReport(reportId: string, action: string) {
    const res = await apiFetch("/api/admin/reports/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId, action }),
    });
    return adminJson<any>(res);
  },
  async getSettings() {
    const res = await apiFetch("/api/admin/settings");
    return adminJson<{ settings: Record<string, string> }>(res);
  },
  async updateSetting(key: string, value: string | boolean) {
    const res = await apiFetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: typeof value === "boolean" ? (value ? "1" : "0") : value }),
    });
    return adminJson<any>(res);
  },
  async getPendingClasswork() {
    const res = await apiFetch("/api/admin/classwork/pending");
    return adminJson<{ classwork: any[] }>(res);
  },
  async approveClasswork(id: string, approve = true) {
    const res = await apiFetch("/api/admin/classwork/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approve }),
    });
    return adminJson<any>(res);
  },
  async getActiveAlerts() {
    try {
      const res = await apiFetch("/api/alerts/active");
      if (!res.ok) return { alerts: [] };
      return apiJson<{ alerts: any[] }>(res);
    } catch {
      return { alerts: [] };
    }
  },
};

// --- TEACHER SERVICE ---
async function teacherJson<T>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await apiJson<any>(res);
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(
      (typeof data?.error === "string" && data.error) ||
        data?.message ||
        `Teacher request failed (${res.status})`
    );
  }
  return data as T;
}

export const teacherService = {
  async getStudentAssignments() {
    return teacherJson<{ assignments: any[] }>(await apiFetch("/api/teacher/assignments/student"));
  },
  async getProfile() {
    return teacherJson<{ profile: any }>(await apiFetch("/api/teacher/profile"));
  },
  async getDashboard() {
    return teacherJson<any>(await apiFetch("/api/teacher/dashboard"));
  },
  async getRoster(section?: string) {
    const query = section ? `?section=${encodeURIComponent(section)}` : "";
    return teacherJson<{ students: any[] }>(await apiFetch(`/api/teacher/roster${query}`));
  },
  async getStudentNotes(studentId: string) {
    return teacherJson<any>(await apiFetch(`/api/teacher/students/${encodeURIComponent(studentId)}/notes`));
  },
  async addStudentNote(studentId: string, note: string) {
    return teacherJson<any>(await apiFetch(`/api/teacher/students/${encodeURIComponent(studentId)}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    }));
  },
  async getAssignments() {
    return teacherJson<{ assignments: any[] }>(await apiFetch("/api/teacher/assignments"));
  },
  async createAssignment(data: {
    subject: string;
    title: string;
    content: string;
    dueDate: string;
    sections: string[];
    attachment?: { filename: string; mimeType: string; data: string } | null;
  }) {
    return teacherJson<any>(
      await apiFetch("/api/teacher/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    );
  },
  async getSubmissions(assignmentId: string) {
    return teacherJson<any>(await apiFetch(`/api/teacher/assignments/${encodeURIComponent(assignmentId)}/submissions`));
  },
  async getAttendance() {
    return teacherJson<{ sessions: any[] }>(await apiFetch("/api/teacher/attendance"));
  },
  async getAttendanceReport(params: { section?: string; from?: string; to?: string } = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => Boolean(value)) as string[][]).toString();
    return teacherJson<any>(await apiFetch(`/api/teacher/attendance/report${query ? `?${query}` : ""}`));
  },
  async getLeaveRequests() {
    return teacherJson<{ requests: any[] }>(await apiFetch("/api/teacher/leave"));
  },
  async updateLeaveRequest(id: string, status: string, reviewerNote?: string) {
    return teacherJson<any>(await apiFetch(`/api/teacher/leave/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewerNote }),
    }));
  },
  async saveAttendance(data: { section: string; date: string; title?: string; records: any[] }) {
    return teacherJson<any>(
      await apiFetch("/api/teacher/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    );
  },
  async getDuties() {
    return teacherJson<{ duties: any[] }>(await apiFetch("/api/teacher/duties"));
  },
  async createDuty(data: any) {
    return teacherJson<any>(
      await apiFetch("/api/teacher/duties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    );
  },
  async updateDuty(id: string, status: string) {
    return teacherJson<any>(
      await apiFetch(`/api/teacher/duties/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
    );
  },
  async getAnnouncements() {
    return teacherJson<{ announcements: any[] }>(await apiFetch("/api/teacher/announcements"));
  },
  async createAnnouncement(data: { section: string; title: string; content: string }) {
    return teacherJson<any>(
      await apiFetch("/api/teacher/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    );
  },
  async getParents() {
    return teacherJson<{ parents: any[] }>(await apiFetch("/api/teacher/parents"));
  },
};

export const leaveService = {
  async getMine() {
    return teacherJson<{ requests: any[] }>(await apiFetch("/api/teacher/leave/my"));
  },
  async getAttendance() {
    return teacherJson<{
      records: any[];
      counts: Record<string, number>;
      total: number;
      attendanceRate: number | null;
    }>(await apiFetch("/api/teacher/attendance/student"));
  },
  async create(data: { fromDate: string; toDate: string; reason: string }) {
    return teacherJson<any>(await apiFetch("/api/teacher/leave/my", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }));
  },
};
