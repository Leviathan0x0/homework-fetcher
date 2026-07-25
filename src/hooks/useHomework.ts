import { useState, useEffect, useCallback } from "react";
import { HomeworkEntry, ViewType, SessionStatus } from "../types/homework";
import { sortHomeworkNewestFirst } from "../utils/dateUtils";
import { authService, homeworkService } from "../services/appwriteServices";

export interface UserAccount {
  id: string;
  studentId: string;
  section?: string;
}

export function useHomework() {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  const [homework, setHomework] = useState<HomeworkEntry[]>([]);

  const [lastUpdated, setLastUpdated] = useState<string | null>(() => localStorage.getItem("lastUpdated") || null);
  const [activeView, setActiveView] = useState<ViewType>(() => (localStorage.getItem("activeView") as ViewType) || "today");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>("");
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>("All");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("disconnected");

  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({});
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  useEffect(() => {
    localStorage.setItem("activeView", activeView);
  }, [activeView]);

  const checkAuth = useCallback(async () => {
    setIsAuthChecking(true);
    try {
      const currentUser = await authService.getCurrentUser();
      if (currentUser) {
        setUser(currentUser);
        setIsAuthenticated(true);
        setSessionStatus("connected");
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setSessionStatus("disconnected");
      }
    } catch (err) {
      console.error("Check Auth Error:", err);
      setUser(null);
      setIsAuthenticated(false);
      setSessionStatus("disconnected");
    } finally {
      setIsAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const fetchHomework = useCallback(async (forceRefresh: boolean = false) => {
    if (!user) return;
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const list = await homeworkService.getHomework(user.id);
      const sortedList = sortHomeworkNewestFirst(list);
      setHomework(sortedList);

      const newCompletedMap: Record<string, boolean> = {};
      const newNotesMap: Record<string, string> = {};

      sortedList.forEach((item) => {
        if (item.id) {
          if (typeof item.completed === "boolean") {
            newCompletedMap[item.id] = item.completed;
          }
          if (item.note) {
            newNotesMap[item.id] = item.note;
          }
        }
      });

      setCompletedMap(newCompletedMap);
      setNotesMap(newNotesMap);

      const timeNow = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setLastUpdated(timeNow);
      localStorage.setItem("lastUpdated", timeNow);
    } catch (err: any) {
      console.error("Fetch Homework Error:", err);
      setErrorMessage(err.message || "Failed to fetch homework.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  const toggleTaskCompleted = useCallback(async (id: string) => {
    if (!id || !user) return;
    const nextState = !completedMap[id];

    setCompletedMap((prev) => ({ ...prev, [id]: nextState }));
    setHomework((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: nextState } : item))
    );

    try {
      await homeworkService.toggleCompleted(user.id, id, nextState);
    } catch (err) {
      console.error("Update status error:", err);
      setCompletedMap((prev) => ({ ...prev, [id]: !nextState }));
      setHomework((prev) =>
        prev.map((item) => (item.id === id ? { ...item, completed: !nextState } : item))
      );
    }
  }, [completedMap, user]);

  const updateHomeworkNote = useCallback(async (id: string, note: string | null) => {
    if (!id || !user) return;

    setNotesMap((prev) => ({ ...prev, [id]: note || "" }));
    setHomework((prev) =>
      prev.map((item) => (item.id === id ? { ...item, note } : item))
    );

    try {
      await homeworkService.updateNote(user.id, id, note);
    } catch (err) {
      console.error("Update note error:", err);
    }
  }, [user]);

  const login = useCallback(async (studentId: string, pass: string): Promise<boolean> => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loggedUser = await authService.login(studentId, pass);
      if (!loggedUser) throw new Error("Authentication failed");
      setUser(loggedUser);
      setIsAuthenticated(true);
      setSessionStatus("connected");
      return true;
    } catch (err: any) {
      console.error("Login Error:", err);
      setErrorMessage(err.message || "Failed to authenticate.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authService.logout();
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      setHomework([]);
      setLastUpdated(null);
      setErrorMessage(null);
      setSessionStatus("disconnected");
      setCompletedMap({});
      setNotesMap({});
      localStorage.removeItem("lastUpdated");
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && user && !isAuthChecking) {
      fetchHomework(false);
    }
  }, [isAuthenticated, user, isAuthChecking, fetchHomework]);

  return {
    user,
    isAuthenticated,
    isAuthChecking,
    homework,
    lastUpdated,
    activeView,
    searchQuery,
    selectedDateFilter,
    selectedSubjectFilter,
    completedMap,
    notesMap,
    isLoading,
    isRefreshing,
    errorMessage,
    sessionStatus,
    setActiveView,
    setSearchQuery,
    setSelectedDateFilter,
    setSelectedSubjectFilter,
    toggleTaskCompleted,
    updateHomeworkNote,
    fetchHomework,
    login,
    logout,
    dismissError: () => setErrorMessage(null),
  };
}
