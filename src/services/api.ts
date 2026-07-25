import { apiFetch, apiJson } from "../lib/api";
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
        section: data.user.section || "Section 10-A",
      };
    } catch (err) {
      console.error("getCurrentUser error:", err);
      return null;
    }
  },

  async login(studentId: string, pass: string) {
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

    return {
      id: data.user.id,
      studentId: data.user.studentId,
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
