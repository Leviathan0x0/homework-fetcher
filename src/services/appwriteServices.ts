import { account, databases, storage, realtime, APPWRITE_DATABASE_ID, APPWRITE_BUCKET_ID, COLLECTIONS } from "../lib/appwrite";
import { ID, Query } from "appwrite";

// --- AUTH SERVICE ---
export const authService = {
  async getCurrentUser() {
    try {
      const user = await account.get();
      const userDocs = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.USERS,
        [Query.equal("studentId", user.email.split("@")[0] || user.name)]
      );
      const section = userDocs.documents[0]?.section || "Section 10-A";
      return {
        id: user.$id,
        studentId: user.email.split("@")[0] || user.name || user.$id,
        section,
      };
    } catch (err) {
      return null;
    }
  },

  async login(studentId: string, pass: string) {
    const email = `${studentId.trim().toLowerCase()}@edusecure.appwrite.local`;
    try {
      await account.createEmailPasswordSession(email, pass);
    } catch (err: any) {
      if (err.code === 404 || err.type === "user_not_found") {
        await account.create(ID.unique(), email, pass, studentId);
        await account.createEmailPasswordSession(email, pass);
        await databases.createDocument(
          APPWRITE_DATABASE_ID,
          COLLECTIONS.USERS,
          ID.unique(),
          { studentId: studentId.trim(), section: "Section 10-A" }
        );
      } else {
        throw new Error(err.message || "Authentication failed");
      }
    }
    return await this.getCurrentUser();
  },

  async logout() {
    try {
      await account.deleteSession("current");
    } catch (err) {
      console.error("Logout error:", err);
    }
  }
};

// --- HOMEWORK SERVICE ---
export const homeworkService = {
  async getHomework(userId: string) {
    try {
      const res = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK,
        [Query.equal("userId", userId), Query.limit(100)]
      );
      
      const states = await databases.listDocuments(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK_USER_STATE,
        [Query.equal("userId", userId), Query.limit(100)]
      );
      const stateMap: Record<string, { completed: boolean; note?: string }> = {};
      states.documents.forEach((d: any) => {
        stateMap[d.homeworkId] = { completed: d.completed, note: d.note };
      });

      return res.documents.map((doc: any) => ({
        id: doc.$id,
        sourceIdentifier: doc.sourceIdentifier || "edusecure",
        date: doc.date,
        subject: doc.subject,
        content: doc.content,
        attachmentUrl: doc.attachmentUrl,
        type: doc.type || "Homework",
        completed: stateMap[doc.$id]?.completed || false,
        note: stateMap[doc.$id]?.note || "",
      }));
    } catch (err) {
      console.error("Error loading homework:", err);
      return [];
    }
  },

  async toggleCompleted(userId: string, homeworkId: string, completed: boolean) {
    const existing = await databases.listDocuments(
      APPWRITE_DATABASE_ID,
      COLLECTIONS.HOMEWORK_USER_STATE,
      [Query.equal("userId", userId), Query.equal("homeworkId", homeworkId)]
    );
    if (existing.documents.length > 0) {
      await databases.updateDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK_USER_STATE,
        existing.documents[0].$id,
        { completed }
      );
    } else {
      await databases.createDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK_USER_STATE,
        ID.unique(),
        { userId, homeworkId, completed, note: "" }
      );
    }
  },

  async updateNote(userId: string, homeworkId: string, note: string | null) {
    const existing = await databases.listDocuments(
      APPWRITE_DATABASE_ID,
      COLLECTIONS.HOMEWORK_USER_STATE,
      [Query.equal("userId", userId), Query.equal("homeworkId", homeworkId)]
    );
    if (existing.documents.length > 0) {
      await databases.updateDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK_USER_STATE,
        existing.documents[0].$id,
        { note: note || "" }
      );
    } else {
      await databases.createDocument(
        APPWRITE_DATABASE_ID,
        COLLECTIONS.HOMEWORK_USER_STATE,
        ID.unique(),
        { userId, homeworkId, completed: false, note: note || "" }
      );
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
