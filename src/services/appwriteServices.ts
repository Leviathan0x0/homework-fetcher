import { account, databases, storage, realtime, APPWRITE_DATABASE_ID, APPWRITE_BUCKET_ID, COLLECTIONS } from "../lib/appwrite";
import { ID, Query } from "appwrite";

// --- AUTH SERVICE ---
export const authService = {
  async getCurrentUser() {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) return null;
      const data = await res.json();
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

  async login(studentId: string, pass: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: studentId.trim(), password: pass })
    });

    const data = await res.json();
    if (!res.ok || !data.authenticated) {
      throw new Error(data.error || "Invalid student ID or password.");
    }

    return {
      id: data.user.id,
      studentId: data.user.studentId,
      displayName: data.user.displayName || null,
      section: data.user.section || "Section 10-A",
    };
  },

  async logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Logout error:", err);
    }
  }
};

// --- HOMEWORK SERVICE ---
export const homeworkService = {
  async getHomework(userId: string) {
    try {
      const res = await fetch("/api/homework", {
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to fetch homework.");
      }
      const data = await res.json();
      return (data.homework || []).map((doc: any) => ({
        id: doc.id,
        type: doc.type || "School Diary",
        date: doc.date || "",
        subject: doc.subject || "School Diary",
        homework: doc.homework || doc.content || "",
        attachment: doc.attachment || doc.attachmentUrl || null,
        completed: !!doc.completed,
        note: doc.note || null,
        updatedAt: doc.updatedAt,
      }));
    } catch (err: any) {
      console.error("Error loading homework:", err);
      return [];
    }
  },

  async toggleCompleted(userId: string, homeworkId: string, completed: boolean) {
    const res = await fetch(`/api/homework/${encodeURIComponent(homeworkId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ completed })
    });
    if (!res.ok) {
      throw new Error("Failed to update completion status.");
    }
  },

  async updateNote(userId: string, homeworkId: string, note: string | null) {
    const res = await fetch(`/api/homework/${encodeURIComponent(homeworkId)}/note`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ note })
    });
    if (!res.ok) {
      throw new Error("Failed to update note.");
    }
  }
};

// --- CLASSWORK SERVICE ---
export const classworkService = {
  async getUploads(section: string) {
    const res = await databases.listDocuments(
      APPWRITE_DATABASE_ID,
      COLLECTIONS.CLASSWORK_UPLOADS,
      [Query.equal("section", section), Query.limit(100)]
    );
    return res.documents;
  },

  async uploadFile(file: File, userId: string, studentId: string, section: string, subject: string, title?: string, date?: string) {
    const createdFile = await storage.createFile(APPWRITE_BUCKET_ID, ID.unique(), file);
    const fileUrl = storage.getFileView(APPWRITE_BUCKET_ID, createdFile.$id).href;

    const doc = await databases.createDocument(
      APPWRITE_DATABASE_ID,
      COLLECTIONS.CLASSWORK_UPLOADS,
      ID.unique(),
      {
        userId,
        studentId,
        section,
        subject,
        title: title || file.name,
        date: date || new Date().toISOString().split("T")[0],
        fileId: createdFile.$id,
        fileUrl,
        originalFilename: file.name,
        fileSize: file.size,
        mimeType: file.type,
      }
    );
    return doc;
  },

  async deleteUpload(docId: string, fileId: string) {
    await databases.deleteDocument(APPWRITE_DATABASE_ID, COLLECTIONS.CLASSWORK_UPLOADS, docId);
    try {
      await storage.deleteFile(APPWRITE_BUCKET_ID, fileId);
    } catch (e) {}
  }
};

// --- REQUESTS SERVICE ---
export const requestsService = {
  async getRequests(section: string) {
    const res = await databases.listDocuments(
      APPWRITE_DATABASE_ID,
      COLLECTIONS.SECTION_REQUESTS,
      [Query.equal("section", section), Query.limit(100)]
    );
    return res.documents;
  },

  async createRequest(userId: string, studentId: string, section: string, title: string, content: string, category?: string) {
    return await databases.createDocument(
      APPWRITE_DATABASE_ID,
      COLLECTIONS.SECTION_REQUESTS,
      ID.unique(),
      { userId, studentId, section, title, content, category, status: "open" }
    );
  }
};
