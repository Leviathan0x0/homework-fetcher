import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { notificationService, messagingService, requestService } from '../services/api';
import { cn } from '../utils/cn';
import { useHomework } from '../hooks/useHomework';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useIsMobile } from '../hooks/use-mobile';
import { LoginPage } from './LoginPage';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { SiteHeader } from './site-header';
import { MobileNavigation } from './MobileNavigation';
import { TodayView } from './TodayView';
import { ErrorBanner } from './ErrorBanner';
import { OfflineBanner } from './OfflineBanner';
import { isTodayDate } from '../utils/dateUtils';
import { setPendingMessageOpen } from '../utils/pendingMessageOpen';
import { Loader2 } from 'lucide-react';
import { ViewType } from '../types/homework';

// Only the landing view ships in the first bundle. The rest — including the
// chat client, the charting admin/teacher portals and the file preview — is
// fetched the first time a student actually opens that screen, which keeps the
// startup download (and every subsequent interaction) small.
const CalendarView = lazy(() => import('./CalendarView').then((m) => ({ default: m.CalendarView })));
const ExamsView = lazy(() => import('./ExamsView').then((m) => ({ default: m.ExamsView })));
const RecentView = lazy(() => import('./RecentView').then((m) => ({ default: m.RecentView })));
const AllHomeworkView = lazy(() => import('./AllHomeworkView').then((m) => ({ default: m.AllHomeworkView })));
const AttachmentsView = lazy(() => import('./AttachmentsView').then((m) => ({ default: m.AttachmentsView })));
const CompletedView = lazy(() => import('./CompletedView').then((m) => ({ default: m.CompletedView })));
const ClassworkView = lazy(() => import('./ClassworkView').then((m) => ({ default: m.ClassworkView })));
const RequestsView = lazy(() => import('./RequestsView').then((m) => ({ default: m.RequestsView })));
const LeaveView = lazy(() => import('./LeaveView').then((m) => ({ default: m.LeaveView })));
const MessagesView = lazy(() => import('./MessagesView').then((m) => ({ default: m.MessagesView })));
const SettingsModal = lazy(() => import('./SettingsModal').then((m) => ({ default: m.SettingsModal })));
const SettingsView = lazy(() => import('./SettingsView').then((m) => ({ default: m.SettingsView })));
const DevelopersView = lazy(() => import('./DevelopersView').then((m) => ({ default: m.DevelopersView })));
const AdminView = lazy(() => import('./AdminView').then((m) => ({ default: m.AdminView })));
const TeacherView = lazy(() => import('./TeacherView').then((m) => ({ default: m.TeacherView })));
const FilePreviewSidebar = lazy(() => import('./FilePreviewSidebar').then((m) => ({ default: m.FilePreviewSidebar })));
const ReconnectSchoolDialog = lazy(() => import('./ReconnectSchoolDialog').then((m) => ({ default: m.ReconnectSchoolDialog })));

/** Placeholder shown while a screen's code is still downloading. */
const ViewFallback: React.FC = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
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

  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReconnectOpen, setIsReconnectOpen] = useState(false);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [previewOriginalFilename, setPreviewOriginalFilename] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [openRequestsCount, setOpenRequestsCount] = useState(0);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const viewBeforeSettings = useRef<typeof activeView>('today');

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
      setOpenRequestsCount((reqs || []).filter((r: { status?: string }) => r.status === 'open').length);
    } catch {
      // Glance counts are best-effort.
    }
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    refreshGlanceCounts();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshGlanceCounts();
    }, 20000);
    const onUnreadChanged = () => refreshGlanceCounts();
    window.addEventListener('messages_unread_changed', onUnreadChanged);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('messages_unread_changed', onUnreadChanged);
    };
    // Deliberately not keyed on activeView: the badge counts are the same on
    // every screen, and re-running this on navigation made each click wait for
    // two network requests before the new view could settle.
  }, [isAuthenticated, user, refreshGlanceCounts]);

  const todayCount = homework.filter((item) => isTodayDate(item.date)).length;

  useKeyboardShortcuts({
    onSearchFocus: () => {
      if (!isAuthenticated) return;
      setActiveView('all');
      setTimeout(() => {
        const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }, 50);
    },
    onRefresh: () => {
      if (isAuthenticated) fetchHomework(true);
    },
    onViewChange: (view) => {
      if (isAuthenticated) setActiveView(view);
    },
  });

  // Phones get a dedicated settings page; desktop keeps the modal.
  const handleOpenSettings = () => handleViewChange('settings');
  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
    if (activeView === 'settings') {
      setActiveView('today');
    }
  };

  const handleLeaveSettings = () => {
    setActiveView(viewBeforeSettings.current === 'settings' ? 'today' : viewBeforeSettings.current);
  };

  function handleViewChange(view: typeof activeView) {
    if (view.startsWith('admin-') && !isAdmin) {
      setActiveView('today');
      return;
    }
    if (view.startsWith('teacher-') && !isTeacher) {
      setActiveView('today');
      return;
    }
    if (view === 'settings') {
      if (isMobile) {
        if (activeView !== 'settings') viewBeforeSettings.current = activeView;
        setActiveView('settings');
      } else {
        setIsSettingsOpen(true);
      }
      return;
    }
    setActiveView(view);
  }

  // A settings page left over from a narrow viewport becomes the modal again.
  useEffect(() => {
    if (activeView !== 'settings') return;
    // Checked directly so the first render, before the media query resolves,
    // cannot mistake a phone for a desktop.
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    handleLeaveSettings();
    setIsSettingsOpen(true);
  }, [isMobile, activeView]);

  const isAdmin = Boolean(user?.isAdmin || user?.studentId === 'admin_mmss');
  const isTeacher = !isAdmin && Boolean(user?.isTeacher || user?.role === 'teacher' || user?.role === 'class_teacher');
  const portalPath = isAdmin ? '/admin' : isTeacher ? '/teacher' : '/student';

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
    if (isAdmin && !activeView.startsWith('admin-') && activeView !== 'settings' && activeView !== 'developers') {
      setActiveView('admin-overview');
    }
    if (isTeacher && !activeView.startsWith('teacher-') && activeView !== 'settings' && activeView !== 'developers') {
      setActiveView('teacher-overview');
    }
    if (!isAdmin && !isTeacher && (activeView.startsWith('admin-') || activeView.startsWith('teacher-'))) {
      setActiveView('today');
    }
  }, [isAdmin, isTeacher, portalPath, activeView, isAuthenticated, isAuthChecking, user, setActiveView]);

  const handleOpenPreview = (url: string, filename?: string) => {
    setPreviewFileUrl(url);
    setPreviewOriginalFilename(filename || null);
  };

  const handleClosePreview = () => {
    setPreviewFileUrl(null);
    setPreviewOriginalFilename(null);
  };

  const handleNavigate = useCallback((view: string) => {
    if (view.startsWith('admin-') && !isAdmin) {
      setActiveView('today');
      return;
    }
    if (view.startsWith('teacher-') && !isTeacher) {
      setActiveView('today');
      return;
    }
    if (view.startsWith('messages:')) {
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
    setActiveView(view as any);
  }, [isAdmin, isTeacher, setActiveView]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      if (!user) return;
      setUnreadCount(await notificationService.getUnreadCount());
    } catch {}
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchUnreadCount();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchUnreadCount();
    }, 20000);
    const onUnreadChanged = () => fetchUnreadCount();
    window.addEventListener('messages_unread_changed', onUnreadChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('messages_unread_changed', onUnreadChanged);
    };
  }, [isAuthenticated, fetchUnreadCount]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen w-full bg-neutral-50 dark:bg-[#09090b] flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center p-1 border border-neutral-200/80 dark:border-neutral-800 shadow-2xs overflow-hidden">
            <img src="/logo.png" alt="MMSS Mohali" className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 mt-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />
            <span>Checking your session</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginPage
        onLogin={login}
        isLoading={isLoading}
        errorMessage={errorMessage}
        onDismissError={dismissError}
      />
    );
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        todayCount={todayCount}
        user={user}
        sessionStatus={sessionStatus}
        onLogout={logout}
        onRefresh={() => fetchHomework(true)}
        isLoading={isLoading || isRefreshing}
      />

      <SidebarInset className={cn("bg-neutral-50/50 dark:bg-[#09090b]", activeView === 'messages' && "h-dvh max-h-dvh overflow-hidden flex flex-col")}>
        <SiteHeader
          activeView={activeView}
          theme={resolvedTheme}
          onToggleTheme={toggleTheme}
          onRefresh={() => fetchHomework(true)}
          onOpenSettings={handleOpenSettings}
          isLoading={isLoading || isRefreshing}
          isDemo={Boolean(user?.isDemo)}
          unreadCount={unreadCount}
          onNavigate={handleNavigate}
          onUnreadCountChange={setUnreadCount}
        />

        <Suspense fallback={<ViewFallback />}>
        <div className={cn(
          "flex-1 w-full mx-auto min-h-0",
          activeView === 'messages'
            ? "relative h-[calc(100dvh-7rem-env(safe-area-inset-top))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] p-0 max-w-none flex flex-col overflow-hidden"
            : "max-w-[1100px] px-4 sm:px-6 lg:px-8 py-6 pb-[var(--mobile-nav-clearance,calc(6.5rem+env(safe-area-inset-bottom)))] md:pb-10 space-y-6"
        )}>
          {errorMessage && (
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
              unreadMessages={messagesUnread}
              openRequests={openRequestsCount}
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
              <MessagesView userSection={user?.section} />
            </div>
          )}

          {activeView === 'calendar' && (
            <CalendarView
              homework={homework}
              isLoading={isLoading}
              onRefresh={(force) => fetchHomework(force)}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
            />
          )}

          {activeView === 'exams' && (
            <ExamsView
              homework={homework}
              isLoading={isLoading}
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
              onUserChange={setUser}
              sessionStatus={sessionStatus}
              schoolSessionExpired={schoolSessionExpired}
              onReconnect={() => setIsReconnectOpen(true)}
              theme={theme}
              onThemeChange={setTheme}
              onBack={handleLeaveSettings}
            />
          )}

          {activeView === 'developers' && <DevelopersView />}
          {activeView.startsWith('admin-') && (
            <AdminView activeSubView={activeView} onNavigate={handleViewChange} />
          )}
          {activeView.startsWith('teacher-') && (
            <TeacherView activeSubView={activeView} onNavigate={handleViewChange} />
          )}
        </div>
        </Suspense>

        {!(activeView === 'messages' && isMobileChatOpen) && (
          <MobileNavigation
            activeView={activeView}
            onViewChange={handleViewChange}
            messagesUnread={messagesUnread}
            openRequests={openRequestsCount}
          />
        )}

        {isSettingsOpen && (
          <Suspense fallback={null}>
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={handleCloseSettings}
              user={user}
              onLogout={logout}
              onUserChange={setUser}
              sessionStatus={sessionStatus}
              schoolSessionExpired={schoolSessionExpired}
              onReconnect={() => setIsReconnectOpen(true)}
              theme={theme}
              onThemeChange={setTheme}
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
