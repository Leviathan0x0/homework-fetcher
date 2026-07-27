import { apiFetch, apiJson, apiUrl } from "../lib/api";

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
    return Array.isArray(parsed) ? parsed : [];
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

// --- AUTH SERVICE ---
export const authService = {
  async getCurrentUser() {
    try {
      const res = await apiFetch("/api/auth/me", {
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) return null;
      const data = await apiJson<any>(res);
      if (!data.authenticated || !data.user) return null;
      return {
        id: data.user.id,
        studentId: data.user.studentId,
        displayName: data.user.displayName || null,
        section: data.user.section || "Section 10-A",
      };
    } catch (err) {
      console.error("getCurrentUser error:", err);
      return null;
    }
  },

  async login(studentId: string, pass: string, _chosenSection?: string) {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ studentId: studentId.trim(), password: pass })
    });

    const data = await apiJson<any>(res);
    if (!res.ok || !data.authenticated) {
      const msg = typeof data.error === "string" ? data.error : (data.error?.message || data.message || "Invalid student ID or password.");
      throw new Error(msg);
    }

    // A new session must never read the previous account's cached conversations.
    clearConversationCache();

    return {
      id: data.user.id,
      studentId: data.user.studentId,
      displayName: data.user.displayName || null,
      section: data.user.section || "Section 10-A",
    };
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
    return {
      id: data.user.id,
      studentId: data.user.studentId,
      displayName: data.user.displayName || null,
      section: data.user.section || "Section 10-A",
    };
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
  async getHomework(userId: string) {
    try {
      const res = await apiFetch("/api/homework", {
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) {
        const errData = await apiJson<any>(res).catch(() => ({} as any));
        throw new Error(errData.message || "Failed to fetch homework.");
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
      return deduplicated;
    } catch (err: any) {
      console.error("Error loading homework:", err);
      return [];
    }
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

// --- MESSAGING SERVICE ---
/** Maps an API message payload to the UI message shape. */
function mapMessage(raw: any) {
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    senderId: raw.senderId,
    senderStudentId: raw.senderStudentId || raw.senderId,
    senderName: raw.senderName || null,
    content: raw.content || "",
    attachmentUrl: raw.attachmentUrl ? apiUrl(raw.attachmentUrl) : null,
    originalFilename: raw.originalFilename || null,
    mimeType: raw.mimeType || null,
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

  /** Conversations stored by the previous load, available synchronously. */
  getCachedConversations() {
    return readConversationCache();
  },

  async getConversations(_currentStudentId?: string) {
    const res = await apiFetch("/api/conversations", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Failed to load conversations.");
    const data = await apiJson<any>(res);
    const conversations = data.conversations || [];
    writeConversationCache(conversations);
    return conversations;
  },

  async deleteConversation(convId: string) {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}`, { method: "DELETE" });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to delete conversation.");
    writeConversationCache(readConversationCache().filter((c: any) => c.id !== convId));
  },

  async deleteMessage(messageId: string) {
    const res = await apiFetch(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
    const data = await apiJson<any>(res);
    if (!res.ok) throw new Error(data.error || "Failed to delete message.");
  },

  async getMessages(convId: string) {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Failed to load messages.");
    const data = await apiJson<any>(res);
    return (data.messages || []).map(mapMessage);
  },

  async sendMessage(convId: string, _senderStudentId: string, content: string, file?: File | null) {
    const formData = new FormData();
    if (content) formData.append("content", content);
    if (file) formData.append("file", file);

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

  async startConversation(_currentStudentId: string, participantId: string, noticeToken: string) {
    const res = await apiFetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ participantId, noticeToken }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.conversationId) {
      throw new Error(data.error || "Failed to start conversation.");
    }
    return { conversationId: data.conversationId, otherUser: data.otherUser || null };
  },

  async markAsRead(convId: string) {
    await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/read`, { method: "PATCH" }).catch(() => {});
  },

  /**
   * Polls a conversation for messages the client has not seen yet.
   * Returns an unsubscribe function, mirroring a realtime subscription.
   */
  subscribeToMessages(convId: string, onMessageReceived: (message: any) => void, intervalMs = 2500) {
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

  async createRequest(
    _userId: string,
    _studentId: string,
    _section: string,
    title?: string,
    content?: string,
    category?: string
  ) {
    const res = await apiFetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title, content, category }),
    });
    const data = await apiJson<any>(res);
    if (!res.ok || !data.request) throw new Error(data.error || "Failed to create request.");
    return data.request;
  },

  async updateStatus(id: string, status: string) {
    const res = await apiFetch(`/api/requests/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error("Failed to update request.");
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
