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
      // Fallback: Check local Express API if running locally
      try {
        const res = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated && data.user) {
            return {
              id: data.user.id,
              studentId: data.user.studentId,
              section: data.user.section || "Section 10-A",
            };
          }
        }
      } catch {}
      return null;
    }
  },

  async login(studentId: string, pass: string) {
    const cleanId = studentId.trim();
    if (!cleanId || !pass) {
      throw new Error("Student ID and password are required.");
    }

    // First try standard Express API login if available
    try {
      const apiRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ studentId: cleanId, password: pass }),
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data.authenticated && data.user) {
          return {
            id: data.user.id,
            studentId: data.user.studentId,
            section: data.user.section || "Section 10-A",
          };
        }
      }
    } catch {}

    // 100% Appwrite Direct Fallback
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
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
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
      console.warn("Appwrite Database query fallback to Express/Local API:", err);
    }

    // Fallback: Fetch from Express backend or return initial defaults
    try {
      const res = await fetch("/api/homework", { headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (data.homework && Array.isArray(data.homework)) {
          return data.homework.map((doc: any) => ({
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
        }
      }
    } catch {}

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
      return;
    } catch {}

    try {
      await fetch(`/api/homework/${encodeURIComponent(homeworkId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ completed }),
      });
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
      return;
    } catch {}

    try {
      await fetch(`/api/homework/${encodeURIComponent(homeworkId)}/note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ note }),
      });
    } catch {}
  }
};
