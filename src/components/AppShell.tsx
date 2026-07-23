import React, { useState, useEffect, useCallback } from 'react';
import { useHomework } from '../hooks/useHomework';
import { useTheme } from '../hooks/useTheme';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
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
import { FilePreviewSidebar } from './FilePreviewSidebar';
import { ErrorBanner } from './ErrorBanner';
import { isTodayDate } from '../utils/dateUtils';
import { Loader2 } from 'lucide-react';

export const AppShell: React.FC = () => {
  const {
    user,
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [previewOriginalFilename, setPreviewOriginalFilename] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

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

  const handleOpenSettings = () => setIsSettingsOpen(true);
  const handleCloseSettings = () => setIsSettingsOpen(false);

  const handleViewChange = (view: typeof activeView) => {
    if (view === 'settings') {
      setIsSettingsOpen(true);
    } else {
      setActiveView(view);
    }
  };

  const handleOpenPreview = (url: string, filename?: string) => {
    setPreviewFileUrl(url);
    setPreviewOriginalFilename(filename || null);
  };

  const handleClosePreview = () => {
    setPreviewFileUrl(null);
    setPreviewOriginalFilename(null);
  };

  const handleNavigate = useCallback((view: string) => {
    setActiveView(view as any);
  }, [setActiveView]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.count || 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchUnreadCount]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen w-full bg-neutral-50 dark:bg-[#09090b] flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900 flex items-center justify-center font-bold text-base shadow-xs">
            H
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 mt-2">
            <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
            <span>checking authentication...</span>
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

      <SidebarInset className="bg-neutral-50/50 dark:bg-[#09090b]">
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

        <div className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-10 space-y-6">
          {isRefreshing && (
            <div className="flex items-center justify-between gap-2 px-4 py-2 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-medium border border-indigo-200/60 dark:border-indigo-800/40 animate-pulse">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Refreshing homework from school server...</span>
              </div>
            </div>
          )}

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
            <RequestsView userSection={user?.section} />
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
              onRefresh={(force) => fetchHomework(force)}
              completedMap={completedMap}
              onToggleCompleted={toggleTaskCompleted}
              onUpdateNote={updateHomeworkNote}
              onOpenPreview={handleOpenPreview}
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
