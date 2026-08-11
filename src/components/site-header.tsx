import { useState } from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ViewType, ThemeMode } from "../types/homework"
import { SunIcon } from "@/components/ui/sun"
import { MoonIcon } from "@/components/ui/moon"
import { SettingsIcon } from "@/components/ui/settings"
import { NotificationPopover } from "./NotificationPopover"
import { PWAInstallPrompt } from "./PWAInstallPrompt"

interface SiteHeaderProps {
  activeView: ViewType;
  role: 'student' | 'teacher' | 'admin';
  theme: ThemeMode;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  isLoading: boolean;
  unreadCount: number;
  onNavigate: (view: string) => void;
  onUnreadCountChange: (count: number) => void;
}

export function SiteHeader({
  activeView,
  role,
  theme,
  onToggleTheme,
  onOpenSettings,
  unreadCount,
  onNavigate,
  onUnreadCountChange,
}: SiteHeaderProps) {
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  const getBreadcrumbTitle = (view: ViewType) => {
    switch (view) {
      case "today":
        return "Today's homework";
      case "classwork":
        return "Classwork Uploads";
      case "requests":
        return "Requests";
      case "leave":
        return "Leave & absence";
      case "messages":
        return "Messages";
      case "calendar":
        return "Calendar view";
      case "circulars":
        return "School announcements";
      case "important":
        return "Important messages";
      case "exams":
        return "Exam Mode";
      case "recent":
        return "Recent homework";
      case "all":
        return "Search";
      case "attachments":
        return "Attachments";
      case "completed":
        return "Completed homework";
      case "settings":
        return "Settings";
      case "developers":
        return "Meet the Developers";
      case "admin-overview":
        return "System Overview";
      case "admin-students":
        return "Students Directory";
      case "admin-teachers":
        return "Teachers & Staff";
      case "admin-moderation":
        return "Moderation Controls";
      case "admin-alerts":
        return "Broadcast Alerts";
      case "admin-reports":
        return "Flagged Reports Queue";
      case "teacher-overview":
        return "Teacher dashboard";
      case "teacher-assignments":
        return "Assignments";
      case "teacher-attendance":
        return "Attendance";
      case "teacher-duties":
        return "Duties";
      case "teacher-announcements":
        return "Announcements";
      case "teacher-parents":
        return "Parent connections";
      case "teacher-students":
        return "Student profiles";
      case "teacher-leave":
        return "Leave approvals";
      default:
        return "Dashboard";
    }
  };

  return (
    <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-2 border-b border-neutral-200/70 dark:border-neutral-800/70 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-xl px-4 lg:px-6 pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sticky top-0 z-20">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <div className="hidden items-center gap-2 md:flex">
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:inline-flex">
                <span className="text-xs font-medium text-muted-foreground">Dashboard</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:inline-flex" />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-semibold text-xs">
                  {getBreadcrumbTitle(activeView)}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <PWAInstallPrompt variant="button" />

        <NotificationPopover
          role={role}
          unreadCount={unreadCount}
          onNavigate={onNavigate}
          onCountChange={onUnreadCountChange}
        />

        <button
          onClick={onToggleTheme}
          onMouseEnter={() => setHoveredButton('theme')}
          onMouseLeave={() => setHoveredButton(null)}
          className="inline-flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <SunIcon size={16} isAnimated={hoveredButton === 'theme'} />
          ) : (
            <MoonIcon size={16} isAnimated={hoveredButton === 'theme'} />
          )}
        </button>

        <button
          onClick={onOpenSettings}
          onMouseEnter={() => setHoveredButton('settings')}
          onMouseLeave={() => setHoveredButton(null)}
          className="inline-flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50 max-[350px]:hidden"
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon size={16} isAnimated={activeView === "settings" || hoveredButton === 'settings'} />
        </button>
      </div>
    </header>
  );
}
