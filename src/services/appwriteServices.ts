import { account, databases, storage, APPWRITE_DATABASE_ID, APPWRITE_BUCKET_ID, COLLECTIONS } from "../lib/appwrite";
import { ID, Query } from "appwrite";

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
      const studentId = user.name || user.email.split("@")[0];
      const section = (user.prefs && user.prefs.section) ? user.prefs.section : "Section 9-F";
      return {
        id: user.$id,
        studentId,
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
    if (chosenSection) {
      try {
        await account.updatePrefs({ ...appwriteUser.prefs, section: chosenSection });
      } catch {}
    }

    const updatedUser = await account.get();
    const finalSection = (updatedUser.prefs && updatedUser.prefs.section) ? updatedUser.prefs.section : (chosenSection || "Section 9-F");

    // Upsert real student user document in Appwrite USERS collection
    try {
      await databases.createDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.USERS,
        updatedUser.$id,
        {
          student_id: cleanId,
          user_id: updatedUser.$id,
          section: finalSection,
        }
      );
    } catch {}

    return {
      id: updatedUser.$id,
      studentId: updatedUser.name || cleanId,
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
      await account.deleteSession("current");
    } catch {}
  }
};

// --- HOMEWORK SERVICE ---
export const homeworkService = {
  async getHomework(userId: string) {
    let studentId = "student2";
    let password = "123456";
    try {
      studentId = sessionStorage.getItem("activeStudentId") || "student2";
      password = sessionStorage.getItem("activeStudentPass") || "123456";
    } catch {}

    // Try fetching live homework directly from EduSecure scraper endpoint
    try {
      const res = await fetch("/api/homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.homework) && data.homework.length > 0) {
          return data.homework.map((doc: any) => ({
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
        }
      }
    } catch (err) {
      console.warn("Live EduSecure scraper fallback:", err);
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

// --- MESSAGING SERVICE ---
export const messagingService = {
  async searchUsers(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    let usersList: any[] = [];

    // Query Appwrite USERS collection for registered accounts
    try {
      const response = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.USERS,
        [Query.limit(100)]
      );
      if (response && response.documents && response.documents.length > 0) {
        usersList = response.documents.map((doc: any) => ({
          id: doc.user_id || doc.$id,
          studentId: doc.student_id || doc.studentId,
          section: doc.section || "Section 9-F",
        }));
      }
    } catch (err) {
      console.warn("Appwrite USERS query fallback:", err);
    }

    const seedAccounts = [
      { id: "student1", studentId: "student1", section: "Section 9-F" },
      { id: "student2", studentId: "student2", section: "Section 9-F" },
      { id: "kiaan", studentId: "kiaan", section: "Section 9-F" },
      ...usersList
    ];

    const uniqueMap = new Map<string, any>();
    seedAccounts.forEach((u) => {
      if (u.studentId) {
        uniqueMap.set(u.studentId.toLowerCase(), u);
      }
    });

    const allRealUsers = Array.from(uniqueMap.values());

    return allRealUsers.filter((s) => s.studentId.toLowerCase().includes(q));
  },

  async startConversation(participantId: string) {
    return {
      conversationId: `conv-${participantId}`,
      otherUser: {
        id: participantId,
        studentId: participantId,
        section: "Section 9-F",
      }
    };
  }
};
