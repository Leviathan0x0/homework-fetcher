import * as React from "react"
import { ViewType, SessionStatus } from "../types/homework"
import { UserAccount } from "../hooks/useHomework"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import { CalendarCheckIcon } from "@/components/ui/calendar-check"
import { CalendarDaysIcon } from "@/components/ui/calendar-days"
import { UploadIcon } from "@/components/ui/upload"
import { HeartHandshakeIcon } from "@/components/ui/heart-handshake"
import { MessageSquareIcon } from "@/components/ui/message-square"
import { GraduationCapIcon } from "@/components/ui/graduation-cap"
import { ClockIcon } from "@/components/ui/clock"
import { SearchIcon } from "@/components/ui/search"
import { AttachFileIcon } from "@/components/ui/attach-file"
import { CircleCheckIcon } from "@/components/ui/circle-check"
import { SettingsIcon } from "@/components/ui/settings"
import { LayersIcon } from "@/components/ui/layers"
import { LogoutIcon } from "@/components/ui/logout"
import { AlertCircle, Activity, Users, VolumeX, Bell, Flag, ShieldCheck, FileText, ClipboardCheck, ClipboardList, MessageCircle, CalendarDays } from "lucide-react"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
  todayCount: number;
  user: UserAccount | null;
  sessionStatus: SessionStatus;
  onLogout: () => void;
  onRefresh: () => void;
  isLoading: boolean;
}

export function AppSidebar({
  activeView,
  onViewChange,
  todayCount,
  user,
  sessionStatus,
  onLogout,
  onRefresh,
  isLoading,
  ...props
}: AppSidebarProps) {
  const [hoveredId, setHoveredId] = React.useState<ViewType | null>(null);

  const isAdmin = Boolean(user?.isAdmin || user?.studentId === 'admin_mmss' || user?.role === 'admin');
  const isTeacher = !isAdmin && Boolean(user?.isTeacher || user?.role === 'teacher' || user?.role === 'class_teacher');

  const studentNavGroups: {
    label: string;
    items: { id: ViewType; title: string; IconComponent: React.ComponentType<any>; badge?: number }[];
  }[] = [
    {
      label: "Main",
      items: [
        { id: "today" as ViewType, title: "Today", IconComponent: CalendarCheckIcon, badge: todayCount > 0 ? todayCount : undefined },
        { id: "classwork" as ViewType, title: "Classwork", IconComponent: UploadIcon },
        { id: "requests" as ViewType, title: "Requests", IconComponent: HeartHandshakeIcon },
        { id: "leave" as ViewType, title: "Leave & absence", IconComponent: CalendarDays },
        { id: "messages" as ViewType, title: "Messages", IconComponent: MessageSquareIcon },
      ],
    },
    {
      label: "Planning",
      items: [
        { id: "calendar" as ViewType, title: "Calendar", IconComponent: CalendarDaysIcon },
        { id: "exams" as ViewType, title: "Exams", IconComponent: GraduationCapIcon },
      ],
    },
    {
      label: "Library",
      items: [
        { id: "recent" as ViewType, title: "Recent", IconComponent: ClockIcon },
        { id: "all" as ViewType, title: "Search", IconComponent: SearchIcon },
        { id: "attachments" as ViewType, title: "Attachments", IconComponent: AttachFileIcon },
        { id: "completed" as ViewType, title: "Completed", IconComponent: CircleCheckIcon },
      ],
    },
  ];

  const adminNavGroups: {
    label: string;
    items: { id: ViewType; title: string; IconComponent: React.ComponentType<any>; badge?: number }[];
  }[] = [
    {
      label: "Admin Management",
      items: [
        { id: "admin-overview" as ViewType, title: "Overview", IconComponent: ({ className }: any) => <Activity className={className || "size-4"} /> },
        { id: "admin-students" as ViewType, title: "Students", IconComponent: ({ className }: any) => <Users className={className || "size-4"} /> },
        { id: "admin-teachers" as ViewType, title: "Teachers & Staff", IconComponent: GraduationCapIcon },
        { id: "admin-moderation" as ViewType, title: "Moderation & Mutes", IconComponent: ({ className }: any) => <VolumeX className={className || "size-4"} /> },
        { id: "admin-alerts" as ViewType, title: "Broadcast Alerts", IconComponent: ({ className }: any) => <Bell className={className || "size-4"} /> },
        { id: "admin-reports" as ViewType, title: "Flagged Reports", IconComponent: ({ className }: any) => <Flag className={className || "size-4"} /> },
      ],
    },
  ];

  const teacherNavGroups: {
    label: string;
    items: { id: ViewType; title: string; IconComponent: React.ComponentType<any>; badge?: number }[];
  }[] = [
    {
      label: "Teaching",
      items: [
        { id: "teacher-overview", title: "Overview", IconComponent: Activity },
        { id: "teacher-assignments", title: "Assignments", IconComponent: FileText },
        { id: "teacher-attendance", title: "Attendance", IconComponent: ClipboardList },
      ],
    },
    {
      label: "Class management",
      items: [
        { id: "teacher-duties", title: "Duties", IconComponent: ShieldCheck },
        { id: "teacher-announcements", title: "Announcements", IconComponent: Bell },
        { id: "teacher-parents", title: "Parent connections", IconComponent: MessageCircle },
        { id: "teacher-students", title: "Student profiles", IconComponent: Users },
        { id: "teacher-leave", title: "Leave approvals", IconComponent: CalendarDays },
      ],
    },
  ];

  const navGroups = isAdmin ? adminNavGroups : isTeacher ? teacherNavGroups : studentNavGroups;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="group data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <div className="flex aspect-square size-8 items-center justify-center rounded-xl bg-white shrink-0 transition-transform duration-300 group-hover:scale-105 shadow-2xs p-0.5 border border-neutral-200/60 dark:border-neutral-800/60 overflow-hidden">
                <img src="/logo.png" alt="MMSS Mohali Logo" className="w-full h-full object-contain" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold text-xs">MMSS Mohali</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {isAdmin ? "Admin Console" : isTeacher ? "Teacher Workspace" : "Student Portal"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-1">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 group-data-[collapsible=icon]:hidden">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const IconComp = item.IconComponent;
                  const isActive = activeView === item.id;
                  const isHovered = hoveredId === item.id;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        onClick={() => onViewChange(item.id)}
                        onMouseEnter={() => setHoveredId(item.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        isActive={isActive}
                        tooltip={item.title}
                        className="group/sbitem cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                      >
                        <IconComp size={18} isAnimated={isActive || isHovered} className="shrink-0" />
                        <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                        {item.badge !== undefined && (
                          <span className="ml-auto flex size-4.5 items-center justify-center rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-[10px] font-semibold group-data-[collapsible=icon]:hidden">
                            {item.badge}
                          </span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarGroup className="mt-auto py-1">
          <SidebarGroupLabel className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 group-data-[collapsible=icon]:hidden">
            Account
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => onViewChange("developers")}
                  onMouseEnter={() => setHoveredId("developers")}
                  onMouseLeave={() => setHoveredId(null)}
                  isActive={activeView === "developers"}
                  tooltip="Meet the Developers"
                  className="group/sbdev cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                >
                  <LayersIcon size={18} isAnimated={activeView === "developers" || hoveredId === "developers"} className="shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden">Meet the Developers</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => onViewChange("settings")}
                  onMouseEnter={() => setHoveredId("settings")}
                  onMouseLeave={() => setHoveredId(null)}
                  isActive={activeView === "settings"}
                  tooltip="Settings"
                  className="group/sbset cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                >
                  <SettingsIcon size={18} isAnimated={activeView === "settings" || hoveredId === "settings"} className="shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden">Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="p-2.5 flex flex-col gap-2 rounded-2xl bg-sidebar-accent/40 text-sidebar-accent-foreground text-xs border border-sidebar-border/40 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center justify-between">
                <span className="font-semibold truncate text-xs">{user?.displayName || user?.studentId || (isAdmin ? "Administrator" : isTeacher ? "Teacher" : "Student")}</span>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <CircleCheckIcon size={14} /> {isAdmin ? "Admin" : isTeacher ? "Teacher" : "Active"}
                </span>
              </div>
              <button
                onClick={onLogout}
                className="group/sblogout flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 hover:text-rose-700 transition-colors duration-150 cursor-pointer pt-1.5 border-t border-sidebar-border/60 active:scale-95"
              >
                <LogoutIcon size={14} />
                <span>Sign out</span>
              </button>
            </div>

            <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center p-1">
              <SidebarMenuButton
                onClick={onLogout}
                tooltip={`Sign out (${user?.displayName || user?.studentId})`}
                className="group/sbiconlogout cursor-pointer text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl active:scale-95"
              >
                <LogoutIcon size={18} className="shrink-0" />
              </SidebarMenuButton>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
