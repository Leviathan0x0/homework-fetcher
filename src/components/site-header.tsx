import { Fragment, useState } from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ViewType, ThemeMode } from "../types/homework"
import { Reicon } from "@/components/ui/reicon"
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler"
import { NotificationPopover } from "./NotificationPopover"
import { PWAInstallPrompt } from "./PWAInstallPrompt"

/**
 * Nav section each view belongs to, plus the page title.
 *
 * The section is what makes the trail a path instead of "Dashboard > page":
 * the sidebar already groups views this way, so the breadcrumb mirrors the
 * navigation the user can see instead of inventing a second hierarchy.
 */
const VIEW_META: Record<ViewType, { section: string; title: string }> = {
  today: { section: "Main", title: "Today's homework" },
  classwork: { section: "Main", title: "Classwork Uploads" },
  requests: { section: "Main", title: "Requests" },
  messages: { section: "Main", title: "Messages" },
  circulars: { section: "School updates", title: "Circulars" },
  important: { section: "School updates", title: "Important" },
  calendar: { section: "Planning", title: "Calendar view" },
  exams: { section: "Planning", title: "Exam Mode" },
  recent: { section: "Library", title: "Recent homework" },
  all: { section: "Library", title: "Search" },
  attachments: { section: "Library", title: "Attachments" },
  completed: { section: "Library", title: "Completed homework" },
  leave: { section: "Account", title: "Leave & absence" },
  settings: { section: "Account", title: "Settings" },
  developers: { section: "Account", title: "Meet the Developers" },
  "admin-overview": { section: "Admin console", title: "System Overview" },
  "admin-students": { section: "Admin console", title: "Students Directory" },
  "admin-teachers": { section: "Admin console", title: "Teachers and staff" },
  "admin-moderation": { section: "Admin console", title: "Moderation and mutes" },
  "admin-alerts": { section: "Admin console", title: "Broadcast alerts" },
  "admin-reports": { section: "Admin console", title: "Flagged reports queue" },
  "teacher-overview": { section: "Faculty portal", title: "Teacher dashboard" },
  "teacher-assignments": { section: "Faculty portal", title: "Assignments" },
  "teacher-attendance": { section: "Faculty portal", title: "Attendance" },
  "teacher-duties": { section: "Class management", title: "Duties" },
  "teacher-announcements": { section: "Class management", title: "Announcements" },
  "teacher-parents": { section: "Class management", title: "Parent connections" },
  "teacher-students": { section: "Class management", title: "Student profiles" },
  "teacher-leave": { section: "Class management", title: "Leave approvals" },
};

/** Landing view per role, so the root crumb always goes somewhere real. */
const HOME_BY_ROLE = {
  admin: { view: "admin-overview" as ViewType, label: "Overview" },
  teacher: { view: "teacher-overview" as ViewType, label: "Overview" },
  student: { view: "today" as ViewType, label: "Today" },
};

/** First view of each nav section, so the middle crumb is clickable too. */
const SECTION_HOME: Record<string, ViewType> = {
  Main: "today",
  "School updates": "circulars",
  Planning: "calendar",
  Library: "recent",
  Account: "settings",
  "Admin console": "admin-overview",
  "Faculty portal": "teacher-overview",
  "Class management": "teacher-duties",
};

const CRUMB_LINK_CLASS =
  "rounded transition-colors duration-150 cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50";

export interface Crumb {
  key: string;
  label: string;
  /** Present only for crumbs that navigate somewhere. */
  target?: ViewType;
}

/**
 * Builds the header trail for a view: role home > nav section > page.
 *
 * Ancestors that would point at the page already open are dropped, so the
 * trail never reads "Today > Today" and the home crumb disappears once you are
 * home. The last crumb is always the current page and never links to itself.
 */
export function buildCrumbs(activeView: ViewType, role: 'student' | 'teacher' | 'admin'): Crumb[] {
  const home = HOME_BY_ROLE[role] ?? HOME_BY_ROLE.student;
  const meta = VIEW_META[activeView] ?? VIEW_META.today;
  const sectionHome = SECTION_HOME[meta.section];

  const crumbs: Crumb[] = [];
  if (activeView !== home.view) {
    crumbs.push({ key: "home", label: home.label, target: home.view });
  }
  if (sectionHome && sectionHome !== activeView && sectionHome !== home.view) {
    crumbs.push({ key: "section", label: meta.section, target: sectionHome });
  }
  crumbs.push({ key: "current", label: meta.title });
  return crumbs;
}

interface SiteHeaderProps {
  activeView: ViewType;
  role: 'student' | 'teacher' | 'admin';
  theme: ThemeMode;
  onThemeChange: (theme: "light" | "dark") => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  isLoading: boolean;
  unreadCount: number;
  showNotifications: boolean;
  onNavigate: (view: string) => void;
  onUnreadCountChange: (count: number) => void;
}

export function SiteHeader({
  activeView,
  role,
  theme,
  onThemeChange,
  onOpenSettings,
  unreadCount,
  showNotifications,
  onNavigate,
  onUnreadCountChange,
}: SiteHeaderProps) {
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  const crumbs = buildCrumbs(activeView, role);

  return (
    <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-2 border-b border-neutral-200/70 dark:border-neutral-800/70 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-xl px-4 lg:px-6 pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sticky top-0 z-20">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="min-w-0 flex-nowrap">
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1;
                return (
                  <Fragment key={crumb.key}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem className="min-w-0">
                      {crumb.target && !isLast ? (
                        <BreadcrumbLink
                          render={<button type="button" />}
                          onClick={() => onNavigate(crumb.target as string)}
                          className={`${CRUMB_LINK_CLASS} truncate text-xs font-medium text-muted-foreground`}
                        >
                          {crumb.label}
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage className="truncate text-xs font-semibold">
                          {crumb.label}
                        </BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <PWAInstallPrompt variant="button" />

        {showNotifications && (
          <NotificationPopover
            role={role}
            unreadCount={unreadCount}
            onNavigate={onNavigate}
            onCountChange={onUnreadCountChange}
          />
        )}

        <AnimatedThemeToggler
          theme={theme === "dark" ? "dark" : "light"}
          onThemeChange={onThemeChange}
          className="inline-flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50"
          title="Toggle theme"
          aria-label="Toggle theme"
        />

        <button
          onClick={onOpenSettings}
          onMouseEnter={() => setHoveredButton('settings')}
          onMouseLeave={() => setHoveredButton(null)}
          className="inline-flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:focus-visible:ring-neutral-600/50 max-[350px]:hidden"
          title="Settings"
          aria-label="Settings"
        >
          <Reicon name="settings" size={16} preset="gear" isActive={activeView === "settings" || hoveredButton === 'settings'} />
        </button>
      </div>
    </header>
  );
}
