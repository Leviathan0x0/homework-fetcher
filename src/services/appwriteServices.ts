import { account, databases, APPWRITE_DATABASE_ID, COLLECTIONS } from "../lib/appwrite";
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
      const section = (user.prefs && user.prefs.section) ? user.prefs.section : "Section 10-A";
      return {
        id: user.$id,
        studentId,
        section,
      };
    } catch (err) {
      return null;
    }
  },

  async login(studentId: string, pass: string) {
    const cleanId = studentId.trim();
    if (!cleanId || !pass) {
      throw new Error("Student ID and password are required.");
    }

    const email = studentIdToEmail(cleanId);

    try {
      // Attempt login with existing Appwrite credentials
      await account.createEmailPasswordSession(email, pass);
    } catch (authErr: any) {
      // If user account doesn't exist yet, auto-provision and create user account on the fly!
      if (authErr && (authErr.code === 401 || authErr.code === 404 || authErr.type === "user_not_found" || authErr.type === "user_invalid_credentials")) {
        try {
          await account.create(ID.unique(), email, pass, cleanId);
          await account.createEmailPasswordSession(email, pass);
        } catch (createErr: any) {
          throw new Error("Invalid student ID or password.");
        }
      } else {
        throw new Error(authErr.message || "Authentication failed.");
      }
    }

    const appwriteUser = await account.get();
    return {
      id: appwriteUser.$id,
      studentId: appwriteUser.name || cleanId,
      section: (appwriteUser.prefs && appwriteUser.prefs.section) ? appwriteUser.prefs.section : "Section 10-A",
    };
  },

  async logout() {
    try {
      await account.deleteSession("current");
    } catch {}
  }
};

// --- HOMEWORK SERVICE ---
export const homeworkService = {
  async getHomework(userId: string) {
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
