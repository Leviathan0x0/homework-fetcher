import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { CalendarView } from './CalendarView';
import { ExamsView } from './ExamsView';
import { RecentView } from './RecentView';
import { AllHomeworkView } from './AllHomeworkView';
import { AttachmentsView } from './AttachmentsView';
import { CompletedView } from './CompletedView';
import { ClassworkView } from './ClassworkView';
import { RequestsView } from './RequestsView';
import { MessagesView } from './MessagesView';
import { SettingsModal } from './SettingsModal';
import { SettingsView } from './SettingsView';
import { FilePreviewSidebar } from './FilePreviewSidebar';
import { ErrorBanner } from './ErrorBanner';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { OfflineBanner } from './OfflineBanner';
import { isTodayDate } from '../utils/dateUtils';
import { setPendingMessageOpen } from '../utils/pendingMessageOpen';
import { Loader2 } from 'lucide-react';
import { ViewType } from '../types/homework';

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

  const { theme, setTheme, toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  }, [isAuthenticated, user, activeView, refreshGlanceCounts]);

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
  }, [setActiveView]);

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
          theme={theme}
          onToggleTheme={toggleTheme}
          onRefresh={() => fetchHomework(true)}
          onOpenSettings={handleOpenSettings}
          isLoading={isLoading || isRefreshing}
          unreadCount={unreadCount}
          onNavigate={handleNavigate}
          onUnreadCountChange={setUnreadCount}
        />

        <div className={cn(
          "flex-1 w-full mx-auto min-h-0",
          activeView === 'messages'
            ? "relative h-[calc(100dvh-7rem-env(safe-area-inset-top))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] p-0 max-w-none flex flex-col overflow-hidden"
            : "max-w-[1100px] px-4 sm:px-6 lg:px-8 py-6 pb-[var(--mobile-nav-clearance,calc(6.5rem+env(safe-area-inset-bottom)))] md:pb-10 space-y-6"
        )}>
          {errorMessage && (
            <ErrorBanner
              message={errorMessage}
              onRetry={() => fetchHomework(true)}
              onOpenSettings={handleOpenSettings}
            />
          )}

          {activeView !== 'messages' && <OfflineBanner />}
          {/* Keep a hidden instance on Messages so the 12s delay survives tab switches. */}
          {activeView === 'messages' ? (
            <div className="hidden" aria-hidden>
              <PWAInstallPrompt variant="banner" />
            </div>
          ) : (
            <PWAInstallPrompt variant="banner" />
          )}
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
              theme={theme}
              onThemeChange={setTheme}
              onBack={handleLeaveSettings}
            />
          )}
        </div>

        {!(activeView === 'messages' && isMobileChatOpen) && (
          <MobileNavigation
            activeView={activeView}
            onViewChange={handleViewChange}
            messagesUnread={messagesUnread}
            openRequests={openRequestsCount}
          />
        )}

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={handleCloseSettings}
          user={user}
          onLogout={logout}
          onUserChange={setUser}
          sessionStatus={sessionStatus}
          theme={theme}
          onThemeChange={setTheme}
        />

        <FilePreviewSidebar
          fileUrl={previewFileUrl}
          onClose={handleClosePreview}
          originalFilename={previewOriginalFilename}
        />
      </SidebarInset>
    </SidebarProvider>
  );
};
