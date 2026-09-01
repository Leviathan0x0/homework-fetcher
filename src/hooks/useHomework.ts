import { useState, useEffect, useCallback, useRef } from "react";
import { HomeworkEntry, ViewType, SessionStatus } from "../types/homework";
import { sortHomeworkNewestFirst, isTodayDate } from "../utils/dateUtils";
import { authService, homeworkService } from "../services/api";
import { loadHomeworkWithRevalidation } from "../services/homeworkLoader";

export interface UserAccount {
  id: string;
  studentId: string;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  section?: string;
  isAdmin?: boolean;
  isTeacher?: boolean;
  role?: string;
  teacherProfile?: {
    subjects: string[];
    assignedSections: string[];
    classTeacherSections: string[];
  } | null;
}

/**
 * Last signed-in account and the homework it was showing.
 *
 * Every screen used to start from nothing and wait for a full round trip
 * before it could render anything at all, so a slow API turned into a blank
 * "Checking your session" page followed by an empty dashboard. Re-using the
 * previous result lets the app paint immediately and correct itself once the
 * server answers; the server still authorises every request, so this only ever
 * affects what is drawn, never what the account is allowed to see.
 */
const CACHED_USER_KEY = "cachedUser";
const CACHED_HOMEWORK_PREFIX = "cachedHomework:";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or unavailable storage quota only costs the head start.
  }
}

function readCachedUser(): UserAccount | null {
  const cached = readJson<UserAccount | null>(CACHED_USER_KEY, null);
  return cached && cached.id && cached.studentId ? cached : null;
}

function readCachedHomework(userId?: string | null): HomeworkEntry[] {
  if (!userId) return [];
  const cached = readJson<HomeworkEntry[]>(`${CACHED_HOMEWORK_PREFIX}${userId}`, []);
  return Array.isArray(cached) ? cached : [];
}

function clearCachedAccount(userId?: string | null) {
  try {
    localStorage.removeItem(CACHED_USER_KEY);
    if (userId) localStorage.removeItem(`${CACHED_HOMEWORK_PREFIX}${userId}`);
  } catch {}
}

/** The screen a role lands on after signing in. */
function defaultViewForUser(account: UserAccount): ViewType {
  if (account.isAdmin || account.role === "admin") return "admin-overview";
  if (account.isTeacher || account.role === "teacher" || account.role === "class_teacher") {
    return "teacher-overview";
  }
  return "today";
}

/**
 * Whether this account has a school-portal login behind it.
 *
 * Administrators authenticate against local credentials and teachers use the
 * teacher portal, so neither has an EduSecure diary. Asking for their homework
 * anyway came back as "your school session expired" - for an account that
 * never had one - and offered a reconnect that could only ever be refused.
 */
function usesSchoolPortal(account: UserAccount | null): boolean {
  if (!account) return false;
  if (account.isAdmin || account.role === "admin") return false;
  if (account.isTeacher || account.role === "teacher" || account.role === "class_teacher") {
    return false;
  }
  return true;
}

export function useHomework() {
  const initialUser = useRef<UserAccount | null>(readCachedUser()).current;
  const initialHomework = useRef<HomeworkEntry[]>(readCachedHomework(initialUser?.id)).current;

  const [user, setUser] = useState<UserAccount | null>(initialUser);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!initialUser);
  // A cached account is enough to draw the app immediately; the session is
  // revalidated in the background and the account, its role landing screen and
  // its data are corrected as soon as the server answers. Blocking the whole
  // UI on that round trip meant every launch started with seconds of
  // "Checking your session" before anything could be shown, and it also held
  // back the first homework request until the check had finished.
  // A cached list that has no entries for today has not yet proved that today's
  // diary is empty. Keep today's loading state until the first homework fetch settles.
  const hasSettledFirstHomeworkFetch = useRef<boolean>(
    initialHomework.some((item) => Boolean(item?.date && isTodayDate(item.date)))
  );
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(false);

  const [homework, setHomework] = useState<HomeworkEntry[]>(initialHomework);

  const [lastUpdated, setLastUpdated] = useState<string | null>(() => localStorage.getItem("lastUpdated") || null);
  const [activeView, setActiveView] = useState<ViewType>(
    () => (initialUser ? defaultViewForUser(initialUser) : (localStorage.getItem("activeView") as ViewType)) || "today"
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>("");
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>("All");
  // An authenticated student with no cached rows has not yet proved that the
  // diary is empty. Keep every homework view in its loading state until the
  // first request settles so an empty-state message never flashes as a false
  // verdict between session validation and the fetch effect below.
  // When there is no cachedUser at all the check is not a user-visible gate
  // (AppShell only gated on the old isAuthChecking), so the homework loading
  // state has to cover the auth window itself.
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (initialUser && usesSchoolPortal(initialUser)) {
      return !hasSettledFirstHomeworkFetch.current;
    }
    // No cached account yet. If the last homework cache was empty we have not
    // proved anything — stay in loading until the first fetch settles.
    return !hasSettledFirstHomeworkFetch.current;
  });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(() => {
    if (initialUser && usesSchoolPortal(initialUser)) {
      return hasSettledFirstHomeworkFetch.current;
    }
    return false;
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(initialUser ? "connected" : "disconnected");
  // The school portal ends its own session long before the app session does, so
  // it is tracked separately: the student stays signed in here while homework
  // can no longer be scraped, and the fix is a password, not a re-login.
  const [schoolSessionExpired, setSchoolSessionExpired] = useState<boolean>(false);

  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    initialHomework.forEach((item) => {
      if (item.id && typeof item.completed === "boolean") map[item.id] = item.completed;
    });
    return map;
  });
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  // The role landing screen is applied once. Re-applying it whenever the
  // session is re-validated would drag the student back off whatever screen
  // they had already opened.
  const hasAppliedRoleView = useRef<boolean>(!!initialUser);

  // Read inside callbacks that must not be re-created whenever the list
  // changes: fetchHomework is a dependency of the effect that calls it, so a
  // changing identity would make it fetch itself in a loop.
  const homeworkRef = useRef<HomeworkEntry[]>(homework);
  const homeworkRequestInFlightRef = useRef(false);
  useEffect(() => {
    homeworkRef.current = homework;
  }, [homework]);

  useEffect(() => {
    localStorage.setItem("activeView", activeView);
  }, [activeView]);

  const checkAuth = useCallback(async () => {
    // ponytail: show the full-screen session gate only when we have nothing cached to paint
    if (!initialUser) setIsAuthChecking(true);
    try {
      const currentUser = await authService.getCurrentUser();
      if (currentUser) {
        const isSameAccount = initialUser?.id === currentUser.id;
        const cachedHomework = isSameAccount
          ? homeworkRef.current
          : readCachedHomework(currentUser.id);
        if (!isSameAccount) {
          homeworkRef.current = cachedHomework;
          setHomework(cachedHomework);
          hasSettledFirstHomeworkFetch.current = cachedHomework.some((item) => Boolean(item?.date && isTodayDate(item.date)));
        }
        const willLoadHomework = usesSchoolPortal(currentUser);
        const settled = hasSettledFirstHomeworkFetch.current;
        setIsLoading(willLoadHomework && !settled);
        setIsRefreshing(willLoadHomework && settled);
        // from re-triggering every effect that depends on the account.
        setUser((previous) =>
          previous && JSON.stringify(previous) === JSON.stringify(currentUser) ? previous : currentUser
        );
        setIsAuthenticated(true);
        setSessionStatus("connected");
        writeJson(CACHED_USER_KEY, currentUser);
        const cachedRoleHome = initialUser ? defaultViewForUser(initialUser) : null;
        const currentRoleHome = defaultViewForUser(currentUser);
        if (!hasAppliedRoleView.current || (cachedRoleHome && cachedRoleHome !== currentRoleHome)) {
          hasAppliedRoleView.current = true;
          setActiveView(currentRoleHome);
        }
      } else {
        clearCachedAccount(initialUser?.id);
        setUser(null);
        setIsAuthenticated(false);
        homeworkRef.current = [];
        setHomework([]);
        setErrorMessage(null);
        setSessionStatus("disconnected");
        setIsLoading(false);
        setIsRefreshing(false);
      }
    } catch (err) {
      // A revalidation that could not reach the server must not sign a student
      // out: the cached account keeps the app usable until the next attempt.
      console.error("Check Auth Error:", err);
      if (!initialUser) {
        setUser(null);
        setIsAuthenticated(false);
        setSessionStatus("disconnected");
        // Keep isLoading honest: with no account and no homework we still
        // have nothing to adjudicate, so the next fetch (after login) starts
        // from loading rather than a false empty state.
        hasSettledFirstHomeworkFetch.current = false;
        setIsLoading(true);
        setIsRefreshing(false);
      }
    } finally {
      setIsAuthChecking(false);
    }
  }, [initialUser]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      isAuthChecking ||
      !user ||
      !usesSchoolPortal(user) ||
      user.displayName
    ) {
      return;
    }

    let cancelled = false;
    const syncMissingDisplayName = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        if (!cancelled && currentUser?.displayName) {
          setUser(currentUser);
          writeJson(CACHED_USER_KEY, currentUser);
        }
      } catch {
        // The server keeps retrying the optional EduSecure profile lookup.
      }
    };

    syncMissingDisplayName();
    const interval = window.setInterval(syncMissingDisplayName, 30 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isAuthenticated, isAuthChecking, user, user?.displayName]);

  const fetchHomework = useCallback(async (forceRefresh: boolean = false) => {
    if (!user || !usesSchoolPortal(user)) return;
    if (homeworkRequestInFlightRef.current) return;
    homeworkRequestInFlightRef.current = true;
    // Preserve useful cached rows during a refresh. When the page is empty,
    // however, the centered loading state is the only honest status until the
    // request completes; a spinner in the distant refresh button is too easy
    // to miss and leaves the empty-state copy looking authoritative.
    // Honour the settlement flag as well: stale-painting zero today rows after
    const settled = hasSettledFirstHomeworkFetch.current;
    const hasVisibleHomework = settled && homeworkRef.current.length > 0;
    setIsLoading(!hasVisibleHomework);
    setIsRefreshing(hasVisibleHomework);
    setErrorMessage(null);

    try {
      const applyResult = (items: HomeworkEntry[], portalExpired: boolean) => {
        const sortedList = sortHomeworkNewestFirst(items);
        homeworkRef.current = sortedList;
        setHomework(sortedList);
        writeJson(`${CACHED_HOMEWORK_PREFIX}${user.id}`, sortedList);
        setSchoolSessionExpired(portalExpired);
        if (portalExpired) {
          setErrorMessage("Your school session has expired.");
        }

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
      };

      const result = await loadHomeworkWithRevalidation(
        (refresh) => homeworkService.getHomework(user.id, refresh),
        forceRefresh,
        (staleResult) => {
          applyResult(staleResult.items, staleResult.schoolSessionExpired);
          hasSettledFirstHomeworkFetch.current = true;
          setIsLoading(false);
          setIsRefreshing(true);
        },
      );
      hasSettledFirstHomeworkFetch.current = true;
      applyResult(result.items, result.schoolSessionExpired);

      if (!result.isStale) {
        const timeNow = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setLastUpdated(timeNow);
        localStorage.setItem("lastUpdated", timeNow);
      }
    } catch (err: any) {
      console.error("Fetch Homework Error:", err);
      hasSettledFirstHomeworkFetch.current = true;
      if (err?.code === "SCHOOL_SESSION_EXPIRED") {
        setSchoolSessionExpired(true);
        setErrorMessage(err.message || "Your school session has expired.");
      } else if (err?.code !== "UNAUTHENTICATED") {
        setErrorMessage(err.message || "Failed to fetch homework.");
      }
    } finally {
      hasSettledFirstHomeworkFetch.current = true;
      setIsLoading(false);
      setIsRefreshing(false);
      homeworkRequestInFlightRef.current = false;
    }
  }, [user]);

  /** Called once the school portal has accepted the password again. */
  const handleSchoolReconnected = useCallback(() => {
    setSchoolSessionExpired(false);
    setErrorMessage(null);
    fetchHomework(true);
  }, [fetchHomework]);

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

  const login = useCallback(async (studentId: string, pass: string, chosenSection?: string): Promise<boolean> => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loggedUser = await authService.login(studentId, pass, chosenSection);
      if (!loggedUser) throw new Error("Authentication failed");
      // A different account must never inherit the previous one's dashboard.
      if (user && user.id !== loggedUser.id) clearCachedAccount(user.id);
      setUser(loggedUser);
      setIsAuthenticated(true);
      setSessionStatus("connected");
      setSchoolSessionExpired(false);
      const cachedHomework = readCachedHomework(loggedUser.id);
      homeworkRef.current = cachedHomework;
      setHomework(cachedHomework);
      hasSettledFirstHomeworkFetch.current = cachedHomework.some((item) => Boolean(item?.date && isTodayDate(item.date)));
      const willLoadHomework = usesSchoolPortal(loggedUser);
      setIsLoading(willLoadHomework && !hasSettledFirstHomeworkFetch.current);
      setIsRefreshing(willLoadHomework && hasSettledFirstHomeworkFetch.current);
      writeJson(CACHED_USER_KEY, loggedUser);
      hasAppliedRoleView.current = true;
      setActiveView(defaultViewForUser(loggedUser));
      return true;
    } catch (err: any) {
      console.error("Login Error:", err);
      setErrorMessage(err.message || "Failed to authenticate.");
      setIsLoading(false);
      setIsRefreshing(false);
      return false;
    }
  }, [user]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    const previousUserId = user?.id;
    try {
      await authService.logout();
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      clearCachedAccount(previousUserId);
      setUser(null);
      setIsAuthenticated(false);
      homeworkRef.current = [];
      setHomework([]);
      setLastUpdated(null);
      setErrorMessage(null);
      setSessionStatus("disconnected");
      setSchoolSessionExpired(false);
      setCompletedMap({});
      setNotesMap({});
      localStorage.removeItem("lastUpdated");
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated && !isAuthChecking && usesSchoolPortal(user)) {
      fetchHomework(false);
    }
  }, [isAuthenticated, user, isAuthChecking, fetchHomework]);

  useEffect(() => {
    if (!isAuthenticated || isAuthChecking || !usesSchoolPortal(user) || schoolSessionExpired) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") fetchHomework(true);
    };
    const refreshWhenOnline = () => fetchHomework(true);
    const interval = window.setInterval(refreshWhenVisible, 60 * 1000);

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
    };
  }, [isAuthenticated, isAuthChecking, user, schoolSessionExpired, fetchHomework]);

  return {
    user,
    setUser,
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
    schoolSessionExpired,
    handleSchoolReconnected,
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
