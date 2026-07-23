import { useState, useEffect, useCallback } from 'react';
import { HomeworkEntry, ViewType, SessionStatus } from '../types/homework';
import { sortHomeworkNewestFirst } from '../utils/dateUtils';

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

  const [lastUpdated, setLastUpdated] = useState<string | null>(() => localStorage.getItem('lastUpdated') || null);
  const [activeView, setActiveView] = useState<ViewType>(() => (localStorage.getItem('activeView') as ViewType) || 'today');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('All');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('disconnected');

  // Completed Tasks State Map (synced with DB)
  const [completedMap, setCompletedMap] = useState<Record<string, boolean>>({});

  // Notes State Map (synced with DB)
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  // Persist Active View
  useEffect(() => {
    localStorage.setItem('activeView', activeView);
  }, [activeView]);

  // Check Auth Status on Startup
  const checkAuth = useCallback(async () => {
    setIsAuthChecking(true);
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Accept': 'application/json' },
      });
      const data = await res.json();

      if (res.ok && data.authenticated && data.user) {
        setUser(data.user);
        setIsAuthenticated(true);
        setSessionStatus('connected');
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setSessionStatus('disconnected');
      }
    } catch (err) {
      console.error('Check Auth Error:', err);
      setUser(null);
      setIsAuthenticated(false);
      setSessionStatus('disconnected');
    } finally {
      setIsAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Fetch Homework Logic (Cached GET or Forced POST Refresh)
  const fetchHomework = useCallback(async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const url = forceRefresh ? '/api/homework/refresh' : '/api/homework';
      const method = forceRefresh ? 'POST' : 'GET';

      const response = await fetch(url, {
        method,
        headers: {
          'Accept': 'application/json',
        },
      });

      let data: any;
      try {
        data = await response.json();
      } catch {
        if (!response.ok) {
          throw new Error(`Server request failed (${response.status}). Please try again.`);
        }
        throw new Error('Invalid response from server.');
      }

      // If backend returned session expired, handle gracefully
      if (data.sessionExpired) {
        setSessionStatus('expired');
        if (data.warning) setErrorMessage(data.warning);
      } else {
        setSessionStatus('connected');
      }

      // Handle Strict Unauthorized / Unauthenticated without cached homework
      if (response.status === 401 && !data.homework) {
        setUser(null);
        setIsAuthenticated(false);
        setSessionStatus('expired');
        setErrorMessage(data.message || 'Your school session has expired. Please sign in again.');
        return;
      }

      if (!response.ok && !data.homework) {
        throw new Error(data.error || 'Failed to fetch homework.');
      }

      const fetchedList: HomeworkEntry[] = data.homework || [];
      const sortedList = sortHomeworkNewestFirst(fetchedList);
      setHomework(sortedList);

      // Sync completion status map and notes map from database entries
      const newCompletedMap: Record<string, boolean> = {};
      const newNotesMap: Record<string, string> = {};

      sortedList.forEach((item) => {
        if (item.id) {
          if (typeof item.completed === 'boolean') {
            newCompletedMap[item.id] = item.completed;
          }
          if (item.note) {
            newNotesMap[item.id] = item.note;
          }
        }
      });

      setCompletedMap(newCompletedMap);
      setNotesMap(newNotesMap);

      const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastUpdated(timeNow);
      localStorage.setItem('lastUpdated', timeNow);

      if (data.warning) {
        setErrorMessage(data.warning);
      }
    } catch (err: any) {
      console.error('Fetch Homework Error:', err);
      const msg = err.message || 'Unable to connect to school server.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Toggle Task Completion and save to DB
  const toggleTaskCompleted = useCallback(async (id: string) => {
    if (!id) return;
    const nextState = !completedMap[id];

    // Optimistic UI update
    setCompletedMap((prev) => ({ ...prev, [id]: nextState }));
    setHomework((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: nextState } : item))
    );

    try {
      const res = await fetch(`/api/homework/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ completed: nextState }),
      });

      if (!res.ok) {
        // Revert on error
        setCompletedMap((prev) => ({ ...prev, [id]: !nextState }));
        setHomework((prev) =>
          prev.map((item) => (item.id === id ? { ...item, completed: !nextState } : item))
        );
        console.error('Failed to update completion status in backend.');
      }
    } catch (err) {
      console.error('Update status error:', err);
      // Revert on exception
      setCompletedMap((prev) => ({ ...prev, [id]: !nextState }));
      setHomework((prev) =>
        prev.map((item) => (item.id === id ? { ...item, completed: !nextState } : item))
      );
    }
  }, [completedMap]);

  // Update Personal Note and save to DB
  const updateHomeworkNote = useCallback(async (id: string, note: string | null) => {
    if (!id) return;

    // Optimistic UI update
    setNotesMap((prev) => ({ ...prev, [id]: note || '' }));
    setHomework((prev) =>
      prev.map((item) => (item.id === id ? { ...item, note } : item))
    );

    try {
      const res = await fetch(`/api/homework/${encodeURIComponent(id)}/note`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ note }),
      });

      if (!res.ok) {
        console.error('Failed to update note in backend.');
      }
    } catch (err) {
      console.error('Update note error:', err);
    }
  }, []);

  // Login handler
  const login = useCallback(async (studentId: string, pass: string): Promise<boolean> => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ studentId, password: pass }),
      });

      const data = await res.json();

      if (!res.ok || !data.authenticated) {
        throw new Error(data.error || 'Invalid student ID or password.');
      }

      setUser(data.user);
      setIsAuthenticated(true);
      setSessionStatus('connected');

      // Fetch homework immediately after login
      await fetchHomework(false);
      return true;
    } catch (err: any) {
      console.error('Login Error:', err);
      setErrorMessage(err.message || 'Failed to authenticate with school server.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchHomework]);

  // Logout handler
  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      setHomework([]);
      setLastUpdated(null);
      setErrorMessage(null);
      setSessionStatus('disconnected');
      setCompletedMap({});
      setNotesMap({});
      localStorage.removeItem('lastUpdated');
      setIsLoading(false);
    }
  }, []);

  // Automatically fetch cached homework when authenticated
  useEffect(() => {
    if (isAuthenticated && homework.length === 0 && !isAuthChecking) {
      fetchHomework(false);
    }
  }, [isAuthenticated, homework.length, isAuthChecking, fetchHomework]);

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
