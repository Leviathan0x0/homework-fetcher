import React, { useState, useEffect, useCallback, useRef, Suspense, lazy, startTransition } from 'react';
import { notificationService, messagingService, requestService } from '../services/api';
import { cn } from '../utils/cn';
import { useHomework, UserAccount } from '../hooks/useHomework';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useIsMobile } from '../hooks/use-mobile';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { SiteHeader } from './site-header';
import { TodayView } from './TodayView';
import { ErrorBanner } from './ErrorBanner';
import { OfflineBanner } from './OfflineBanner';
import { setPendingMessageOpen } from '../utils/pendingMessageOpen';
import { ViewType } from '../types/homework';
import { SHOW_LEAVE_AND_ABSENCE } from '../utils/features';
import { readAppPreferences, saveAppPreferences } from '../utils/appPreferences';
import { Ring } from "@/components/loading-ui/ring";

type AppRole = 'student' | 'teacher' | 'admin';

// Only the landing view ships in the first bundle. The rest - including the
// chat client, the charting admin/teacher portals and the file preview - is
// fetched the first time a student actually opens that screen, which keeps the
// startup download (and every subsequent interaction) small.
const loadLoginPage = () => import('./LoginPage');
// Signed-out visitors need the login screen straight away: start its download
// in parallel with boot instead of after the first render.
try {
  if (typeof window !== 'undefined' && !window.localStorage.getItem('cachedUser')) void loadLoginPage();
} catch {
  // Storage unavailable: the lazy component loads it on demand.
}
const LoginPage = lazy(() => loadLoginPage().then((m) => ({ default: m.LoginPage })));
const loadCalendarView = () => import('./CalendarView');
const loadSchoolNoticesView = () => import('./SchoolNoticesView');
const loadExamsView = () => import('./ExamsView');
const loadRecentView = () => import('./RecentView');
const loadAllHomeworkView = () => import('./AllHomeworkView');
const loadAttachmentsView = () => import('./AttachmentsView');
const loadCompletedView = () => import('./CompletedView');
const loadClassworkView = () => import('./ClassworkView');
const loadRequestsView = () => import('./RequestsView');
const loadMessagesView = () => import('./MessagesView');
const loadSettingsView = () => import('./SettingsView');
const loadAdminView = () => import('./AdminView');
const loadTeacherView = () => import('./TeacherView');
// The dock (and its WebGPU glass renderer) is only mounted on phones, so
// desktop never downloads it.
const loadMobileNavigation = () => import('./MobileNavigation');

const CalendarView = lazy(() => loadCalendarView().then((m) => ({ default: m.CalendarView })));
const SchoolNoticesView = lazy(() => loadSchoolNoticesView().then((m) => ({ default: m.SchoolNoticesView })));
const ExamsView = lazy(() => loadExamsView().then((m) => ({ default: m.ExamsView })));
const RecentView = lazy(() => loadRecentView().then((m) => ({ default: m.RecentView })));
const AllHomeworkView = lazy(() => loadAllHomeworkView().then((m) => ({ default: m.AllHomeworkView })));
const AttachmentsView = lazy(() => loadAttachmentsView().then((m) => ({ default: m.AttachmentsView })));
const CompletedView = lazy(() => loadCompletedView().then((m) => ({ default: m.CompletedView })));
const ClassworkView = lazy(() => loadClassworkView().then((m) => ({ default: m.ClassworkView })));
const RequestsView = lazy(() => loadRequestsView().then((m) => ({ default: m.RequestsView })));
const LeaveView = lazy(() => import('./LeaveView').then((m) => ({ default: m.LeaveView })));
const MessagesView = lazy(() => loadMessagesView().then((m) => ({ default: m.MessagesView })));
const SettingsView = lazy(() => loadSettingsView().then((m) => ({ default: m.SettingsView })));
const DevelopersView = lazy(() => import('./DevelopersView').then((m) => ({ default: m.DevelopersView })));
const AdminView = lazy(() => loadAdminView().then((m) => ({ default: m.AdminView })));
const TeacherView = lazy(() => loadTeacherView().then((m) => ({ default: m.TeacherView })));
const MobileNavigation = lazy(() => loadMobileNavigation().then((m) => ({ default: m.MobileNavigation })));
const FilePreviewSidebar = lazy(() => import('./FilePreviewSidebar').then((m) => ({ default: m.FilePreviewSidebar })));
const ReconnectSchoolDialog = lazy(() => import('./ReconnectSchoolDialog').then((m) => ({ default: m.ReconnectSchoolDialog })));
const DisplayNamePrompt = lazy(() => import('./DisplayNamePrompt').then((m) => ({ default: m.DisplayNamePrompt })));

/**
 * Screen chunks each role is likely to open, fetched once the browser is idle
 * after sign-in so the first tap on a tab renders immediately instead of
 * waiting on a download.
 */
const PREFETCH_BY_ROLE: Record<'student' | 'teacher' | 'admin', Array<() => Promise<unknown>>> = {
  student: [
    loadAllHomeworkView, loadMessagesView, loadClassworkView, loadRequestsView, loadCalendarView,
    loadSettingsView, loadSchoolNoticesView, loadRecentView, loadExamsView, loadAttachmentsView,
    loadCompletedView,
  ],
  teacher: [loadTeacherView, loadMessagesView, loadSettingsView],
  admin: [loadAdminView, loadSettingsView],
};

function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 1500);
  return () => window.clearTimeout(id);
}
import { NotFoundView } from './NotFoundView';

/** URL paths the SPA owns; anything else is a client-side 404. */
const KNOWN_PATHS = new Set(['/', '/admin', '/teacher', '/student']);

/** Placeholder shown while a screen's code is still downloading. */
const ViewFallback: React.FC = () => (
  <div className="flex items-center justify-center py-16">
    <Ring className="size-4 text-neutral-400" />
  </div>
);

export const AppShell: React.FC = () => {
  const {
    user,
    setUser,
    isAuthenticated,
    isAuthChecking,
    homework,
    lastUpdated,
    activeView,
    searchQuery,
    selectedDateFilter,
    completedMap,
    isLoading,
    isRefreshing,
    errorMessage,
    sessionStatus,
    schoolSessionExpired,
    handleSchoolReconnected,
    setActiveView,
    setSearchQuery,
    setSelectedDateFilter,
    toggleTaskCompleted,
    updateHomeworkNote,
    fetchHomework,
    login,
    logout,
    dismissError,
  } = useHomework();

  const { theme, resolvedTheme, themeId, setTheme, setThemeId } = useTheme();
  const isMobile = useIsMobile();
  const [appPreferences, setAppPreferences] = useState(readAppPreferences);
  const [isReconnectOpen, setIsReconnectOpen] = useState(false);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [previewOriginalFilename, setPreviewOriginalFilename] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [unseenRequestsCount, setUnseenRequestsCount] = useState(0);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const viewBeforeSettings = useRef<typeof activeView>('today');
  const activeViewRef = useRef(activeView);
  const handleUserChange = useCallback((updated: UserAccount) => {
    const merged = user ? { ...user, ...updated } : updated;
    setUser(merged);
    try {
      localStorage.setItem('cachedUser', JSON.stringify(merged));
    } catch {}
  }, [setUser, user]);

  const updateAppPreferences = useCallback((patch: Parameters<typeof saveAppPreferences>[1]) => {
    const next = saveAppPreferences(appPreferences, patch);
    setAppPreferences(next);
  }, [appPreferences]);

  const isAdmin = Boolean(user?.isAdmin || user?.role === 'admin' || user?.studentId === 'admin_mmss');
  const isTeacher = !isAdmin && Boolean(user?.isTeacher || user?.role === 'teacher' || user?.role === 'class_teacher');
  const appRole: AppRole = isAdmin ? 'admin' : isTeacher ? 'teacher' : 'student';
  const roleHome: ViewType = isAdmin ? 'admin-overview' : isTeacher ? 'teacher-overview' : 'today';
  const portalPath = isAdmin ? '/admin' : isTeacher ? '/teacher' : '/student';
  const isHomeworkView = new Set<ViewType>([
    'today',
    'calendar',
    'exams',
    'recent',
    'all',
    'attachments',
    'completed',
  ]).has(activeView);

  const isViewAllowed = useCallback((view: ViewType) => {
    if (view === 'settings' || view === 'developers') return true;
    if (!SHOW_LEAVE_AND_ABSENCE && (view === 'leave' || view === 'teacher-leave')) return false;
    if (isAdmin) return view.startsWith('admin-');
    if (isTeacher) return view.startsWith('teacher-') || view === 'messages';
    return !view.startsWith('admin-') && !view.startsWith('teacher-');
  }, [isAdmin, isTeacher]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const loaders = [...PREFETCH_BY_ROLE[appRole]];
    const cancelIdle: Array<() => void> = [];
    // One chunk per idle slot keeps prefetching from competing with input.
    const next = () => {
      const loader = loaders.shift();
      if (cancelled || !loader) return;
      loader().catch(() => {}).finally(() => {
        if (!cancelled) cancelIdle.push(whenIdle(next));
      });
    };
    cancelIdle.push(whenIdle(next));
    return () => {
      cancelled = true;
      cancelIdle.forEach((cancel) => cancel());
    };
  }, [isAuthenticated, appRole]);

  useEffect(() => {
    const handleActiveConv = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setIsMobileChatOpen(Boolean(detail));
    };
    window.addEventListener('active_conv_changed', handleActiveConv);
    return () => window.removeEventListener('active_conv_changed', handleActiveConv);
  }, []);

  const refreshGlanceCounts = useCallback(async () => {
    if (!user) return;
    if (appRole !== 'student') {
      setMessagesUnread(0);
      setUnseenRequestsCount(0);
      return;
    }
    try {
      const [convs, reqs] = await Promise.all([
        messagingService.getConversations(user.studentId),
        requestService.getRequests(user.section),
      ]);
      // Count conversations with unread mail, not total unread messages.
      const unreadChats = (convs || []).filter(
        (c: { unreadCount?: number }) => (c.unreadCount || 0) > 0
      ).length;
      setMessagesUnread(unreadChats);
      const unseenRequests = (reqs || []).filter(
        (r: { status?: string; isOwner?: boolean; isSeen?: boolean }) =>
          r.status === 'open' && !r.isOwner && r.isSeen === false
      );
      if (activeViewRef.current === 'requests') {
        setUnseenRequestsCount(0);
        requestService.markSeen(unseenRequests.map((request: { id: string }) => request.id)).then(() => {
          window.dispatchEvent(new CustomEvent('requests_seen_changed'));
          window.dispatchEvent(new CustomEvent('notifications_unread_changed'));
        }).catch(() => {});
      } else {
        setUnseenRequestsCount(unseenRequests.length);
      }
    } catch {
      // Glance counts are best-effort.
    }
  }, [user, appRole]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    refreshGlanceCounts();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshGlanceCounts();
    }, 20000);
    const onUnreadChanged = () => refreshGlanceCounts();
    const onRequestsSeen = () => setUnseenRequestsCount(0);
    // Polling pauses while hidden, so catch up as soon as the tab is back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshGlanceCounts();
    };
    window.addEventListener('messages_unread_changed', onUnreadChanged);
    window.addEventListener('requests_seen_changed', onRequestsSeen);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('messages_unread_changed', onUnreadChanged);
      window.removeEventListener('requests_seen_changed', onRequestsSeen);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Deliberately not keyed on activeView: the badge counts are the same on
    // every screen, and re-running this on navigation made each click wait for
    // two network requests before the new view could settle.
  }, [isAuthenticated, user, refreshGlanceCounts]);

  useKeyboardShortcuts({
    onSearchFocus: () => {
      if (!isAuthenticated || appRole !== 'student') return;
      setActiveView('all');
      setTimeout(() => {
        const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }, 50);
    },
    onRefresh: () => {
      if (isAuthenticated && appRole === 'student') fetchHomework(true);
    },
    onViewChange: (view) => {
      if (isAuthenticated && isViewAllowed(view)) setActiveView(view);
    },
  });

  const handleOpenSettings = () => handleViewChange('settings');

  const handleLeaveSettings = useCallback(() => {
    setActiveView(viewBeforeSettings.current === 'settings' ? 'today' : viewBeforeSettings.current);
  }, [setActiveView]);

  const handleViewChange = useCallback((view: typeof activeView) => {
    if (!isViewAllowed(view)) {
      setActiveView(roleHome);
      return;
    }
    if (view === 'requests') {
      setUnseenRequestsCount(0);
      requestService.markSeen().then(() => {
        window.dispatchEvent(new CustomEvent('requests_seen_changed'));
        window.dispatchEvent(new CustomEvent('notifications_unread_changed'));
      }).catch(() => {});
    }
    if (view === 'settings') {
      if (activeView !== 'settings') viewBeforeSettings.current = activeView;
    }
    // A transition keeps the current screen on display while a not-yet-loaded
    // screen downloads, instead of blanking the page to a spinner.
    startTransition(() => setActiveView(view));
  }, [activeView, isViewAllowed, roleHome, setActiveView]);

  useEffect(() => {
    if (isAuthChecking || isAuthenticated) return;
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    if (currentPath === '/admin' || currentPath === '/teacher' || currentPath === '/student') {
      window.history.replaceState({}, '', '/');
    }
  }, [isAuthChecking, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || isAuthChecking || !user) return;
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    if (currentPath === '/' || ['/admin', '/teacher', '/student'].includes(currentPath)) {
      if (currentPath !== portalPath) {
        window.history.replaceState({}, '', portalPath);
      }
    }
    if (!isViewAllowed(activeView)) {
      setActiveView(roleHome);
    }
  }, [portalPath, activeView, isAuthenticated, isAuthChecking, user, setActiveView, isViewAllowed, roleHome]);

  const handleOpenPreview = (url: string, filename?: string) => {
    setPreviewFileUrl(url);
    setPreviewOriginalFilename(filename || null);
  };

  const handleClosePreview = () => {
    setPreviewFileUrl(null);
    setPreviewOriginalFilename(null);
  };

  const handleNavigate = useCallback((view: string) => {
    if (view.startsWith('messages:')) {
      if (!isViewAllowed('messages')) {
        setActiveView(roleHome);
        return;
      }
      const targetConvId = view.slice('messages:'.length).trim();
      if (targetConvId) {
        setPendingMessageOpen({ conversationId: targetConvId });
      }
      setActiveView('messages');
      if (targetConvId) {
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('open_conversation', {
              detail: { conversationId: targetConvId },
            })
          );
        }, 80);
      }
      return;
    }
    handleViewChange(view as ViewType);
  }, [isViewAllowed, roleHome, setActiveView, handleViewChange]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      if (!user) return;
      setUnreadCount(await notificationService.getUnreadCount());
    } catch {}
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!appPreferences.inAppNotifications) {
      setUnreadCount(0);
      return;
    }
    fetchUnreadCount();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchUnreadCount();
    }, 20000);
    const onUnreadChanged = () => fetchUnreadCount();
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchUnreadCount();
    };
    window.addEventListener('messages_unread_changed', onUnreadChanged);
    window.addEventListener('notifications_unread_changed', onUnreadChanged);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('messages_unread_changed', onUnreadChanged);
      window.removeEventListener('notifications_unread_changed', onUnreadChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [appPreferences.inAppNotifications, isAuthenticated, fetchUnreadCount]);

  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (!KNOWN_PATHS.has(normalizedPath)) {
    return <NotFoundView />;
  }

  if (isAuthChecking) {
    return (
      <div className="min-h-screen w-full bg-[#f8f8f8] dark:bg-[#09090b] flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center p-1 border border-neutral-200/80 dark:border-neutral-800 shadow-2xs overflow-hidden">
            <img src="/logo.png" alt="MMSS Mohali" className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 mt-2">
            <Ring className="size-3.5 text-neutral-400" />
            <span>Checking your session</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<div className="min-h-screen w-full bg-[#f8f8f8] dark:bg-[#09090b]" />}>
        <LoginPage
          onLogin={login}
          isLoading={isLoading}
          errorMessage={errorMessage}
          onDismissError={dismissError}
        />
      </Suspense>
    );
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        user={user}
        sessionStatus={sessionStatus}
        onLogout={logout}
        onRefresh={() => fetchHomework(true)}
        isLoading={isLoading || isRefreshing}
      />

      <SidebarInset className={cn("bg-[#f8f8f8]/50 dark:bg-[#09090b]", activeView === 'messages' && "h-dvh max-h-dvh overflow-hidden flex flex-col")}>
        <SiteHeader
          activeView={activeView}
          role={appRole}
          theme={resolvedTheme}
          onThemeChange={setTheme}
          onRefresh={() => fetchHomework(true)}
          onOpenSettings={handleOpenSettings}
          isLoading={isLoading || isRefreshing}
          unreadCount={unreadCount}
          showNotifications={appPreferences.inAppNotifications}
          onNavigate={handleNavigate}
          onUnreadCountChange={setUnreadCount}
        />

        <Suspense fallback={<ViewFallback />}>
        <main
          key={activeView}
          className={cn(
            // CSS enter animation: keeps the motion library off the startup path.
            "animate-in fade-in-[0.94] max-md:slide-in-from-right-4 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none",
            "flex-1 w-full min-w-0 mx-auto min-h-0 overflow-x-hidden",
            activeView === 'messages'
              ? "relative h-[calc(100dvh-7rem-env(safe-area-inset-top))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] p-0 max-w-none flex flex-col overflow-hidden"
              : cn(
                  activeView === 'calendar' ? "max-w-[1400px]" : "max-w-[1100px]",
                  "px-4 sm:px-6 lg:px-8 py-6 pb-[var(--mobile-nav-clearance,calc(6.5rem+env(safe-area-inset-bottom)))] md:pb-10 space-y-6"
                )
          )}
        >
          {user && !isAdmin && !isTeacher && !user.displayName && (
            <DisplayNamePrompt onSaved={handleUserChange} />
          )}
          {errorMessage && isHomeworkView && (
            <ErrorBanner
              message={errorMessage}
              isSchoolSessionExpired={schoolSessionExpired}
              onRetry={() => fetchHomework(true)}
              onReconnect={() => setIsReconnectOpen(true)}
            />
          )}

          {activeView !== 'messages' && <OfflineBanner />}
          {activeView === 'messages' && (
            <OfflineBanner className="mx-3 mt-2 shrink-0" />
          )}

          {activeView === 'today' && (
            <TodayView
              homework={homework}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              onRefresh={(force) => fetchHomework(force)}
              lastUpdated={lastUpdated}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
              displayName={user?.displayName}
              studentId={user?.studentId}
              hasHomeworkError={Boolean(errorMessage)}
              unreadMessages={messagesUnread}
              openRequests={unseenRequestsCount}
              onNavigate={(view: ViewType) => handleViewChange(view)}
            />
          )}
          {activeView === 'classwork' && (
            <ClassworkView
              userSection={user?.section}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {activeView === 'requests' && (
            <RequestsView
              userSection={user?.section}
              onNavigate={(v) => handleNavigate(v)}
            />
          )}
          {activeView === 'leave' && <LeaveView />}

          {activeView === 'messages' && (
            <div className="flex-1 min-h-0">
              <MessagesView userSection={user?.section} currentStudentId={user?.studentId} role={appRole} />
            </div>
          )}

          {activeView === 'calendar' && (
            <CalendarView
              homework={homework}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              onRefresh={(force) => fetchHomework(force)}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {(activeView === 'circulars' || activeView === 'important') && (
            <SchoolNoticesView
              kind={activeView}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {activeView === 'exams' && (
            <ExamsView
              homework={homework}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              onRefresh={(force) => fetchHomework(force)}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {activeView === 'recent' && (
            <RecentView
              homework={homework}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              onRefresh={(force) => fetchHomework(force)}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {activeView === 'all' && (
            <AllHomeworkView
              homework={homework}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              onRefresh={(force) => fetchHomework(force)}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedDateFilter={selectedDateFilter}
              onDateFilterChange={setSelectedDateFilter}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
              userSection={user?.section}
              onNavigate={handleNavigate}
            />
          )}

          {activeView === 'attachments' && (
            <AttachmentsView
              homework={homework}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              onRefresh={(force) => fetchHomework(force)}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {activeView === 'completed' && (
            <CompletedView
              homework={homework}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              onRefresh={(force?: boolean) => { fetchHomework(force); }}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              user={user}
              onLogout={logout}
              onUserChange={handleUserChange}
              sessionStatus={sessionStatus}
              schoolSessionExpired={schoolSessionExpired}
              onReconnect={() => setIsReconnectOpen(true)}
              theme={theme}
              onThemeChange={setTheme}
              resolvedTheme={resolvedTheme}
              themeId={themeId}
              onThemeIdChange={setThemeId}
              autoRefreshMinutes={appPreferences.autoRefreshMinutes}
              onAutoRefreshChange={(autoRefreshMinutes) => updateAppPreferences({ autoRefreshMinutes })}
              inAppNotifications={appPreferences.inAppNotifications}
              onInAppNotificationsChange={(inAppNotifications) => updateAppPreferences({ inAppNotifications })}
              onBack={handleLeaveSettings}
              onSecuritySignOut={logout}
            />
          )}

          {activeView === 'developers' && <DevelopersView />}
          {activeView.startsWith('admin-') && (
            <AdminView activeSubView={activeView} onNavigate={handleViewChange} />
          )}
          {activeView.startsWith('teacher-') && (
            <TeacherView activeSubView={activeView} onNavigate={handleViewChange} onOpenPreview={handleOpenPreview} />
          )}
        </main>
        </Suspense>

        {isMobile && !(activeView === 'messages' && isMobileChatOpen) && (
          <Suspense fallback={null}>
            <MobileNavigation
              activeView={activeView}
              onViewChange={handleViewChange}
              role={appRole}
              messagesUnread={messagesUnread}
              openRequests={unseenRequestsCount}
            />
          </Suspense>
        )}

        {isReconnectOpen && (
          <Suspense fallback={null}>
            <ReconnectSchoolDialog
              isOpen={isReconnectOpen}
              studentId={user?.studentId}
              onClose={() => setIsReconnectOpen(false)}
              onReconnected={handleSchoolReconnected}
            />
          </Suspense>
        )}

        {previewFileUrl && (
          <Suspense fallback={null}>
            <FilePreviewSidebar
              fileUrl={previewFileUrl}
              onClose={handleClosePreview}
              originalFilename={previewOriginalFilename}
            />
          </Suspense>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
};
