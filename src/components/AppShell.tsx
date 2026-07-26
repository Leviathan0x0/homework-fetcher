import React, { useState, useEffect, useCallback, useRef } from 'react';
import { notificationService } from '../services/api';
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
import { isTodayDate } from '../utils/dateUtils';
import { Loader2 } from 'lucide-react';

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
  const viewBeforeSettings = useRef<typeof activeView>('today');

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
  const handleCloseSettings = () => setIsSettingsOpen(false);

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
      const targetConvId = view.slice('messages:'.length);
      setActiveView('messages');
      if (targetConvId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open_conversation', { detail: targetConvId }));
        }, 50);
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
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchUnreadCount]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen w-full bg-neutral-50 dark:bg-[#09090b] flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.svg" alt="MMSS Mohali" className="w-10 h-10 rounded-2xl object-contain shadow-xs" />
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
            ? "h-[calc(100dvh-7rem-env(safe-area-inset-top))] md:h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] p-0 max-w-none flex flex-col overflow-hidden"
            : "max-w-4xl px-4 sm:px-6 lg:px-8 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10 space-y-6"
        )}>
          {errorMessage && (
            <ErrorBanner
              message={errorMessage}
              onRetry={() => fetchHomework(true)}
              onOpenSettings={handleOpenSettings}
            />
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
              onNavigate={(v) => {
                if (v.startsWith('messages:')) {
                  const targetConvId = v.slice('messages:'.length);
                  setActiveView('messages');
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('open_conversation', { detail: targetConvId }));
                  }, 50);
                } else {
                  setActiveView(v as any);
                }
              }}
            />
          )}

          {activeView === 'messages' && (
            <MessagesView userSection={user?.section} />
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

        <MobileNavigation
          activeView={activeView}
          onViewChange={handleViewChange}
        />

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
