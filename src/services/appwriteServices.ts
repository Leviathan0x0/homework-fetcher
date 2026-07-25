import { client, account, databases, storage, APPWRITE_DATABASE_ID, APPWRITE_BUCKET_ID, COLLECTIONS } from "../lib/appwrite";
import { ID, Query } from "appwrite";
import { Message } from "../types/homework";

// Helper to convert Student ID into standard email format for Appwrite Auth
function studentIdToEmail(studentId: string): string {
  const cleanId = studentId.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${cleanId}@homework.internal`;
}

// Initial default homework entries when database collection is newly initialized
const INITIAL_MOCK_HOMEWORK = [
  {
    id: "hw-1",
    type: "School Diary",
    date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    subject: "Mathematics",
    homework: "Complete Exercise 4.2 Questions 1 to 10 in Homework notebook.",
    attachment: null,
    completed: false,
    note: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "hw-2",
    type: "School Diary",
    date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    subject: "Science",
    homework: "Read Chapter 6: Life Processes and answer text questions.",
    attachment: null,
    completed: false,
    note: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "hw-3",
    type: "School Diary",
    date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    subject: "English Literature",
    homework: "Write summary of 'First Flight' Chapter 3 in 150 words.",
    attachment: null,
    completed: false,
    note: null,
    updatedAt: new Date().toISOString(),
  }
];

// --- AUTH SERVICE ---
export const authService = {
  async getCurrentUser() {
    try {
      const user = await account.get();
      if (!user) return null;
      const studentId = (user.prefs && user.prefs.studentId) || user.name || (user.email ? user.email.split("@")[0] : user.$id);
      const section = (user.prefs && user.prefs.section) ? user.prefs.section : "";

      try {
        fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, id: user.$id, section })
        }).catch(() => {});
      } catch {}

      return {
        id: user.$id,
        studentId,
        displayName: user.prefs?.displayName || null,
        section,
      };
    } catch (err) {
      return null;
    }
  },

  async login(studentId: string, pass: string, chosenSection?: string) {
    const cleanId = studentId.trim();
    if (!cleanId || !pass) {
      throw new Error("Student ID and password are required.");
    }

    try {
      sessionStorage.setItem("activeStudentId", cleanId);
      sessionStorage.setItem("activeStudentPass", pass);
      localStorage.setItem("activeStudentId", cleanId);
      localStorage.setItem("activeStudentPass", pass);
    } catch {}

    const email = studentIdToEmail(cleanId);

    try {
      await account.createEmailPasswordSession(email, pass);
    } catch (authErr: any) {
      if (authErr && (authErr.code === 401 || authErr.code === 404 || authErr.type === "user_not_found" || authErr.type === "user_invalid_credentials")) {
        try {
          await account.create(ID.unique(), email, pass, cleanId);
          await account.createEmailPasswordSession(email, pass);
        } catch (createErr: any) {
          throw new Error(createErr.message || "Invalid student ID or password.");
        }
      } else {
        throw new Error(authErr.message || "Authentication failed.");
      }
    }

    const appwriteUser = await account.get();
    try {
      await account.updatePrefs({ ...appwriteUser.prefs, studentId: cleanId, section: chosenSection || "" });
    } catch {}

    const updatedUser = await account.get();
    const finalSection = (updatedUser.prefs && updatedUser.prefs.section) ? updatedUser.prefs.section : (chosenSection || "");

    try {
      fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: cleanId, id: updatedUser.$id, section: finalSection })
      }).catch(() => {});
    } catch {}

    return {
      id: updatedUser.$id,
      studentId: cleanId,
      displayName: updatedUser.prefs?.displayName || null,
      section: finalSection,
    };
  },

  async updateSection(section: string) {
    try {
      const current = await account.get();
      await account.updatePrefs({ ...current.prefs, section });
      return true;
    } catch (err) {
      return false;
    }
  },

  async logout() {
    try {
      sessionStorage.removeItem("activeStudentId");
      sessionStorage.removeItem("activeStudentPass");
      localStorage.removeItem("activeStudentId");
      localStorage.removeItem("activeStudentPass");
      await account.deleteSession("current");
    } catch {}
  }
};

// --- HOMEWORK SERVICE ---
export const homeworkService = {
  async getHomework(userId: string) {
    let studentId = "";
    let password = "";
    try {
      studentId = sessionStorage.getItem("activeStudentId") || localStorage.getItem("activeStudentId") || "";
      password = sessionStorage.getItem("activeStudentPass") || localStorage.getItem("activeStudentPass") || "";
    } catch {}

    // Check cached homework in localStorage first
    let cachedHomework: any[] = [];
    if (studentId) {
      try {
        const cached = localStorage.getItem(`app_homework_cache_${studentId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            cachedHomework = parsed;
          }
        }
      } catch {}
    }

    if (studentId && password) {
      try {
        const res = await fetch("/api/homework", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, password })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.homework) && data.homework.length > 0) {
            const list = data.homework.map((doc: any) => ({
              id: doc.id,
              type: doc.type || "School Diary",
              date: doc.date || "",
              subject: doc.subject || doc.type || "School Diary",
              homework: doc.homework || doc.content || "",
              attachment: doc.attachment || doc.attachmentUrl || null,
              completed: !!doc.completed,
              note: doc.note || null,
              updatedAt: doc.updatedAt || new Date().toISOString(),
            }));

            try {
              localStorage.setItem(`app_homework_cache_${studentId}`, JSON.stringify(list));
            } catch {}

            return list;
          }
        }
      } catch (err) {
        console.warn("Live EduSecure scraper error:", err);
      }
    }

    if (cachedHomework.length > 0) {
      return cachedHomework;
    }

    // Fallback to Appwrite Database collection if offline
    try {
      const response = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK,
        [Query.orderDesc("date"), Query.limit(100)]
      );

      if (response && response.documents && response.documents.length > 0) {
        return response.documents.map((doc: any) => ({
          id: doc.$id || doc.id,
          type: doc.type || "School Diary",
          date: doc.date || "",
          subject: doc.subject || "School Diary",
          homework: doc.homework || doc.content || "",
          attachment: doc.attachment || doc.attachmentUrl || null,
          completed: !!doc.completed,
          note: doc.note || null,
          updatedAt: doc.$updatedAt || doc.updatedAt,
        }));
      }
    } catch (err) {
      console.warn("Appwrite Database query fallback:", err);
    }

    return INITIAL_MOCK_HOMEWORK;
  },

  async toggleCompleted(userId: string, homeworkId: string, completed: boolean) {
    try {
      await databases.updateDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK,
        homeworkId,
        { completed }
      );
    } catch {}
  },

  async updateNote(userId: string, homeworkId: string, note: string | null) {
    try {
      await databases.updateDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK,
        homeworkId,
        { note }
      );
    } catch {}
  }
};

// --- CLASSWORK SERVICE ---
export const classworkService = {
  async getClasswork(section: string = "Section 10-A") {
    try {
      const response = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.CLASSWORK_UPLOADS,
        [Query.orderDesc("$createdAt"), Query.limit(100)]
      );

      if (response && response.documents) {
        return response.documents.map((doc: any) => ({
          id: doc.$id || doc.id,
          title: doc.title || doc.filename || "Classwork Attachment",
          filename: doc.filename || "attachment",
          originalName: doc.originalName || doc.filename || "attachment",
          mimeType: doc.mimeType || "application/octet-stream",
          fileSize: doc.fileSize || 1024,
          fileUrl: doc.fileUrl || (doc.fileId ? storage.getFileView(APPWRITE_BUCKET_ID, doc.fileId).toString() : "#"),
          fileId: doc.fileId || null,
          subject: doc.subject || "General",
          uploadedBy: doc.uploadedBy || "Student",
          uploaderId: doc.uploaderId || "",
          section: doc.section || section,
          createdAt: doc.$createdAt || doc.createdAt || new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.warn("Appwrite Classwork query fallback:", err);
    }
    return [];
  },

  async uploadClasswork(file: File, subject: string, title?: string, section?: string, user?: any) {
    try {
      const uploadedFile = await storage.createFile(
        APPWRITE_BUCKET_ID,
        ID.unique(),
        file
      );

      const fileUrl = storage.getFileView(APPWRITE_BUCKET_ID, uploadedFile.$id).toString();

      const newDoc = await databases.createDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.CLASSWORK_UPLOADS,
        ID.unique(),
        {
          title: title || file.name,
          filename: file.name,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          fileUrl: fileUrl,
          fileId: uploadedFile.$id,
          subject: subject,
          uploadedBy: user?.studentId || "Student",
          uploaderId: user?.id || "",
          section: section || user?.section || "Section 10-A",
          createdAt: new Date().toISOString(),
        }
      );

      return {
        id: newDoc.$id,
        title: newDoc.title,
        filename: newDoc.filename,
        originalName: newDoc.originalName,
        mimeType: newDoc.mimeType,
        fileSize: newDoc.fileSize,
        fileUrl: newDoc.fileUrl,
        fileId: newDoc.fileId,
        subject: newDoc.subject,
        uploadedBy: newDoc.uploadedBy,
        uploaderId: newDoc.uploaderId,
        section: newDoc.section,
        createdAt: newDoc.createdAt,
      };
    } catch (err: any) {
      throw new Error(err.message || "Failed to upload file to Appwrite Storage.");
    }
  },

  async deleteClasswork(id: string, fileId?: string) {
    try {
      if (fileId) {
        try {
          await storage.deleteFile(APPWRITE_BUCKET_ID, fileId);
        } catch {}
      }
      await databases.deleteDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.CLASSWORK_UPLOADS,
        id
      );
    } catch (err: any) {
      throw new Error(err.message || "Failed to delete file.");
    }
  }
};

// --- NOTIFICATION SERVICE ---
export const notificationService = {
  async getNotifications(userId: string) {
    try {
      const res = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.NOTIFICATIONS,
        [Query.equal("user_id", userId), Query.orderDesc("$createdAt"), Query.limit(50)]
      );
      if (res && res.documents) {
        return res.documents.map((doc: any) => ({
          id: doc.$id,
          userId: doc.user_id,
          type: doc.type,
          title: doc.title,
          body: doc.body,
          link: doc.link,
          referenceId: doc.reference_id,
          isRead: doc.is_read ? 1 : 0,
          createdAt: doc.$createdAt,
        }));
      }
    } catch {}
    return [];
  },

  async markAsRead(id: string) {
    try {
      await databases.updateDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.NOTIFICATIONS,
        id,
        { is_read: 1 }
      );
    } catch {}
  },

  async markAllAsRead(userId: string) {
    try {
      const list = await this.getNotifications(userId);
      for (const n of list) {
        if (!n.isRead) {
          await this.markAsRead(n.id);
        }
      }
    } catch {}
  }
};

// --- REQUESTS SERVICE ---
export const requestService = {
  async getRequests(section?: string) {
    try {
      const res = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.SECTION_REQUESTS,
        [Query.orderDesc("$createdAt"), Query.limit(50)]
      );
      if (res && res.documents) {
        return res.documents.map((doc: any) => ({
          id: doc.$id,
          userId: doc.user_id,
          studentId: doc.student_id,
          section: doc.section,
          status: doc.status || "pending",
          createdAt: doc.$createdAt,
        }));
      }
    } catch {}
    return [];
  },

  async createRequest(userId: string, studentId: string, section: string) {
    try {
      const doc = await databases.createDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.SECTION_REQUESTS,
        ID.unique(),
        {
          user_id: userId,
          student_id: studentId,
          section,
          status: "pending",
          createdAt: new Date().toISOString(),
        }
      );
      return {
        id: doc.$id,
        userId: doc.user_id,
        studentId: doc.student_id,
        section: doc.section,
        status: doc.status,
        createdAt: doc.createdAt,
      };
    } catch (err: any) {
      throw new Error(err.message || "Failed to create section request.");
    }
  }
};

export function getConversationId(userA: string, userB: string): string {
  const cleanA = (userA || "").trim().toLowerCase();
  const cleanB = (userB || "").trim().toLowerCase();
  const sorted = [cleanA, cleanB].sort();
  return `conv-${sorted[0]}-${sorted[1]}`;
}

export function getOtherStudentId(convId: string, currentStudentId: string): string {
  if (!convId || !convId.startsWith("conv-")) return convId;
  const parts = convId.replace("conv-", "").split("-");
  if (parts.length === 2) {
    const p1 = parts[0];
    const p2 = parts[1];
    return p1.toLowerCase() === (currentStudentId || "").toLowerCase() ? p2 : p1;
  }
  return convId.replace("conv-", "");
}

// --- MESSAGING SERVICE ---
export const messagingService = {
  subscribeToMessages(convId: string, onMessageReceived: (message: Message) => void) {
    try {
      const channel = `databases.${APPWRITE_DATABASE_ID}.collections.${COLLECTIONS.MESSAGES}.documents`;
      const unsubscribe = client.subscribe(channel, (response: any) => {
        if (
          response &&
          response.events &&
          response.events.some((e: string) => e.includes(".create") || e.includes(".update")) &&
          response.payload
        ) {
          const payload = response.payload;
          const msgConvId = payload.conversation_id || payload.conversationId;
          if (msgConvId === convId) {
            const newMsg: Message = {
              id: payload.$id || payload.id,
              conversationId: msgConvId,
              senderId: payload.sender_id || payload.senderId,
              senderStudentId: payload.sender_student_id || payload.senderId || payload.sender_id,
              content: payload.content || "",
              attachmentUrl: payload.attachment_url || payload.attachmentUrl || null,
              createdAt: payload.$createdAt || payload.createdAt || new Date().toISOString(),
              isMine: false,
            };
            onMessageReceived(newMsg);
          }
        }
      });
      return unsubscribe;
    } catch (err) {
      console.warn("Appwrite Realtime subscription error:", err);
      return () => {};
    }
  },

  async getConversations(currentStudentId: string) {
    let rawList: any[] = [];

    // 1. Load from localStorage cache first
    try {
      const cached = localStorage.getItem("app_conversations_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) rawList = parsed;
      }
    } catch {}

    // 2. Fetch from serverless endpoints
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.conversations)) {
          data.conversations.forEach((c: any) => rawList.push(c));
        }
      }
    } catch {}

    try {
      const res = await fetch("/api/messages?action=conversations");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.conversations)) {
          data.conversations.forEach((c: any) => rawList.push(c));
        }
      }
    } catch {}

    // 3. Filter & compute correct otherUser name for currentStudentId
    const map = new Map<string, any>();
    const myId = (currentStudentId || "").trim().toLowerCase();

    rawList.forEach((c) => {
      if (c && c.id) {
        const otherId = getOtherStudentId(c.id, currentStudentId);
        // Include conversation if user is a participant or if conversation has no prefix
        if (!myId || c.id.toLowerCase().includes(myId) || !c.id.includes("-")) {
          map.set(c.id, {
            id: c.id,
            otherUser: {
              id: otherId,
              studentId: otherId,
              section: c.otherUser?.section || ""
            },
            lastMessagePreview: c.lastMessagePreview || "No messages yet",
            lastMessageAt: c.lastMessageAt || new Date().toISOString(),
            unreadCount: c.unreadCount || 0
          });
        }
      }
    });

    const result = Array.from(map.values()).sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );

    try {
      localStorage.setItem("app_conversations_cache", JSON.stringify(result));
    } catch {}

    return result;
  },

  async getMessages(convId: string) {
    let list: Message[] = [];

    // 1. Read persistent localStorage cache for this conversation
    try {
      const cached = localStorage.getItem(`app_messages_cache_${convId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) list = parsed;
      }
    } catch {}

    // 2. Fetch from serverless messaging endpoint
    try {
      const res = await fetch(`/api/messages?conversationId=${encodeURIComponent(convId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          data.messages.forEach((m: Message) => list.push(m));
        }
      }
    } catch {}

    // 3. Query Appwrite Database COLLECTIONS.MESSAGES if configured
    try {
      const response = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.MESSAGES,
        [Query.equal("conversation_id", convId), Query.limit(100)]
      );
      if (response && response.documents) {
        response.documents.forEach((doc: any) => {
          list.push({
            id: doc.$id,
            conversationId: doc.conversation_id,
            senderId: doc.sender_id,
            senderStudentId: doc.sender_student_id || doc.sender_id,
            content: doc.content || "",
            attachmentUrl: doc.attachment_url || null,
            createdAt: doc.$createdAt || doc.createdAt,
            isMine: false,
          });
        });
      }
    } catch {}

    const map = new Map<string, Message>();
    list.forEach((m) => map.set(m.id, m));
    const sorted = Array.from(map.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    try {
      localStorage.setItem(`app_messages_cache_${convId}`, JSON.stringify(sorted));
    } catch {}

    return sorted;
  },

  async sendMessage(convId: string, senderStudentId: string, content: string, file?: File | null) {
    let attachmentUrl: string | null = null;
    if (file) {
      try {
        const uploadedFile = await storage.createFile(
          APPWRITE_BUCKET_ID,
          ID.unique(),
          file
        );
        attachmentUrl = storage.getFileView(APPWRITE_BUCKET_ID, uploadedFile.$id).toString();
      } catch {}
    }

    let newMsg: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      conversationId: convId,
      senderId: senderStudentId,
      senderStudentId: senderStudentId,
      content: content || "",
      attachmentUrl,
      createdAt: new Date().toISOString(),
      isMine: true,
    };

    // Save to Appwrite Cloud Database
    try {
      await databases.createDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.MESSAGES,
        ID.unique(),
        {
          conversation_id: convId,
          sender_id: senderStudentId,
          sender_student_id: senderStudentId,
          content: content || "",
          attachment_url: attachmentUrl,
        }
      );
    } catch {}

    // Send to serverless messaging endpoint
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMsg)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          newMsg = { ...data.message, isMine: true };
        }
      }
    } catch {}

    // Persist immediately into localStorage cache for convId
    try {
      const cached = localStorage.getItem(`app_messages_cache_${convId}`);
      let list: Message[] = cached ? JSON.parse(cached) : [];
      if (!Array.isArray(list)) list = [];
      if (!list.some((m) => m.id === newMsg.id)) {
        list.push(newMsg);
        localStorage.setItem(`app_messages_cache_${convId}`, JSON.stringify(list));
      }
    } catch {}

    // Also update conversation preview in persistent cache
    try {
      const cachedConvs = localStorage.getItem("app_conversations_cache");
      let convsList: any[] = cachedConvs ? JSON.parse(cachedConvs) : [];
      if (!Array.isArray(convsList)) convsList = [];
      const otherId = getOtherStudentId(convId, senderStudentId);
      const existingIdx = convsList.findIndex((c) => c.id === convId);
      const updatedConv = {
        id: convId,
        otherUser: { id: otherId, studentId: otherId, section: "" },
        lastMessagePreview: attachmentUrl ? "[Attachment]" : content.substring(0, 80),
        lastMessageAt: newMsg.createdAt,
        unreadCount: 0
      };
      if (existingIdx !== -1) {
        convsList[existingIdx] = updatedConv;
      } else {
        convsList.unshift(updatedConv);
      }
      localStorage.setItem("app_conversations_cache", JSON.stringify(convsList));
    } catch {}

    return newMsg;
  },

  async searchUsers(query: string, currentStudentId?: string) {
    const rawQ = query.trim();
    const q = rawQ.toLowerCase();
    if (!q) return [];

    let usersList: any[] = [];

    // 1. Query serverless user registry
    try {
      const res = await fetch(`/api/users?q=${encodeURIComponent(rawQ)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          usersList = data.users;
        }
      }
    } catch (err) {
      console.warn("User directory search error:", err);
    }

    // 2. Query Appwrite USERS collection if available
    try {
      const response = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.USERS,
        [Query.limit(100)]
      );
      if (response && response.documents && response.documents.length > 0) {
        response.documents.forEach((doc: any) => {
          usersList.push({
            id: doc.user_id || doc.$id,
            studentId: doc.student_id || doc.studentId,
            section: doc.section || "",
          });
        });
      }
    } catch {}

    const knownAccounts = [
      { id: "kiaan1240", studentId: "kiaan1240", section: "" },
      { id: "student2", studentId: "student2", section: "" }
    ];

    const uniqueMap = new Map<string, any>();
    knownAccounts.forEach((u) => uniqueMap.set(u.studentId.toLowerCase(), u));
    usersList.forEach((u) => {
      if (u.studentId) {
        uniqueMap.set(u.studentId.toLowerCase(), u);
      }
    });

    const allRealUsers = Array.from(uniqueMap.values());
    const selfId = (currentStudentId || "").trim().toLowerCase();

    return allRealUsers.filter((s) => {
      const match = s.studentId.toLowerCase().includes(q);
      const isSelf = selfId && s.studentId.toLowerCase() === selfId;
      return match && !isSelf;
    });
  },

  async startConversation(currentStudentId: string, targetStudentId: string) {
    const convId = getConversationId(currentStudentId, targetStudentId);
    const newConv = {
      id: convId,
      otherUser: {
        id: targetStudentId,
        studentId: targetStudentId,
        section: "",
      },
      lastMessagePreview: "Started a new conversation",
      lastMessageAt: new Date().toISOString(),
      unreadCount: 0,
    };

    try {
      fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          lastMessagePreview: "Started a new conversation",
          lastMessageAt: newConv.lastMessageAt,
        })
      }).catch(() => {});
    } catch {}

    try {
      const cached = localStorage.getItem("app_conversations_cache");
      let list = cached ? JSON.parse(cached) : [];
      if (!Array.isArray(list)) list = [];
      if (!list.some((c: any) => c && c.id === convId)) {
        list.unshift(newConv);
        localStorage.setItem("app_conversations_cache", JSON.stringify(list));
      }
    } catch {}

    return {
      conversationId: convId,
      otherUser: newConv.otherUser,
    };
  }
};
