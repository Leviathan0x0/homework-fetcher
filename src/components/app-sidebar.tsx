import * as React from "react"
import type { ViewType, SessionStatus } from "../types/homework"
import type { UserAccount } from "../hooks/useHomework"
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
  useSidebar,
} from "@/components/ui/sidebar"
import { Reicon, type ReiconName, type ReiconPreset } from "@/components/ui/reicon"
import { ProfileAvatar } from "./ProfileAvatar"

interface NavItem {
  id: ViewType;
  title: string;
  icon: ReiconName;
  preset?: ReiconPreset;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
  user: UserAccount | null;
  sessionStatus: SessionStatus;
  onLogout: () => void;
  onRefresh: () => void;
  isLoading: boolean;
}

export function AppSidebar({
  activeView,
  onViewChange,
  user,
  sessionStatus: _sessionStatus,
  onLogout,
  onRefresh: _onRefresh,
  isLoading: _isLoading,
  ...props
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  const selectView = React.useCallback((view: ViewType) => {
    onViewChange(view);
    if (isMobile) setOpenMobile(false);
  }, [isMobile, onViewChange, setOpenMobile]);

  const isAdmin = Boolean(user?.isAdmin || user?.studentId === 'admin_mmss' || user?.role === 'admin');
  const isTeacher = !isAdmin && Boolean(user?.isTeacher || user?.role === 'teacher' || user?.role === 'class_teacher');

  const studentNavGroups: NavGroup[] = [
    {
      label: "Main",
      items: [
        { id: "today", title: "Today", icon: "calendar-check" },
        { id: "classwork", title: "Classwork", icon: "upload" },
        { id: "requests", title: "Requests", icon: "heart-handshake" },
        { id: "messages", title: "Messages", icon: "chat-line" },
      ],
    },
    {
      label: "School updates",
      items: [
        { id: "circulars", title: "Circulars", icon: "scroll-text" },
        { id: "important", title: "Important", icon: "megaphone" },
      ],
    },
    {
      label: "Planning",
      items: [
        { id: "calendar", title: "Calendar", icon: "calendar-days" },
        { id: "exams", title: "Exams", icon: "graduation-cap" },
      ],
    },
    {
      label: "Library",
      items: [
        { id: "recent", title: "Recent", icon: "clock" },
        { id: "all", title: "Search", icon: "search" },
        { id: "attachments", title: "Attachments", icon: "paperclip" },
        { id: "completed", title: "Completed", icon: "circle-check" },
      ],
    },
  ];

  const adminNavGroups: NavGroup[] = [
    {
      label: "Admin management",
      items: [
        { id: "admin-overview", title: "Overview", icon: "activity" },
        { id: "admin-students", title: "Students", icon: "users" },
        { id: "admin-teachers", title: "Teachers and staff", icon: "graduation-cap" },
        { id: "admin-moderation", title: "Moderation and mutes", icon: "volume-x" },
        { id: "admin-alerts", title: "Broadcast alerts", icon: "bell" },
        { id: "admin-reports", title: "Flagged reports", icon: "flag" },
      ],
    },
  ];

  const teacherNavGroups: NavGroup[] = [
    {
      label: "Teaching",
      items: [
        { id: "teacher-overview", title: "Overview", icon: "activity" },
        { id: "teacher-assignments", title: "Assignments", icon: "paperclip" },
        { id: "teacher-attendance", title: "Attendance", icon: "calendar-check" },
      ],
    },
    {
      label: "Class management",
      items: [
        { id: "teacher-duties", title: "Duties", icon: "shield-check" },
        { id: "teacher-announcements", title: "Announcements", icon: "bell" },
        { id: "teacher-parents", title: "Parent connections", icon: "chat-line" },
        { id: "teacher-students", title: "Student profiles", icon: "users" },
      ],
    },
  ];

  const navGroups = isAdmin ? adminNavGroups : isTeacher ? teacherNavGroups : studentNavGroups;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="group data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:h-12! group-data-[collapsible=icon]:w-8!">
              <div className="flex aspect-square size-8 items-center justify-center rounded-xl bg-white shrink-0 transition-transform duration-300 group-hover:scale-105 shadow-2xs p-0.5 border border-neutral-200/60 dark:border-neutral-800/60 overflow-hidden">
                <img src="/logo.png" alt="MMSS Mohali Logo" className="w-full h-full object-contain" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold text-xs">MMSS Mohali</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {isAdmin ? "Admin Console" : isTeacher ? "Faculty Portal" : "Student Portal"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-1">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 group-data-[collapsible=icon]:mt-0! group-data-[collapsible=icon]:opacity-100!">
              <span className="group-data-[collapsible=icon]:hidden">{group.label}</span>
              <span className="hidden h-px w-full bg-sidebar-border group-data-[collapsible=icon]:block" aria-hidden />
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = activeView === item.id;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        onClick={() => selectView(item.id)}
                        isActive={isActive}
                        tooltip={item.title}
                        className="cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                      >
                        <Reicon
                          name={item.icon}
                          size={18}
                          isActive={isActive}
                          isFilled={isActive}
                          className="shrink-0"
                        />
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
          <SidebarGroupLabel className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 group-data-[collapsible=icon]:mt-0! group-data-[collapsible=icon]:opacity-100!">
            <span className="group-data-[collapsible=icon]:hidden">Account</span>
            <span className="hidden h-px w-full bg-sidebar-border group-data-[collapsible=icon]:block" aria-hidden />
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => selectView("developers")}
                  isActive={activeView === "developers"}
                  tooltip="Meet the Developers"
                  className="cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                >
                  <Reicon
                    name="layers"
                    size={18}
                    isActive={activeView === "developers"}
                    isFilled={activeView === "developers"}
                    className="shrink-0"
                  />
                  <span className="group-data-[collapsible=icon]:hidden">Meet the Developers</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => selectView("settings")}
                  isActive={activeView === "settings"}
                  tooltip="Settings"
                  className="cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                >
                  <Reicon
                    name="settings"
                    size={18}
                    isActive={activeView === "settings"}
                    isFilled={activeView === "settings"}
                    className="shrink-0"
                  />
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ProfileAvatar
                    src={user?.profilePictureUrl}
                    name={user?.displayName || user?.studentId}
                    className="size-8 text-[10px]"
                  />
                  <span className="truncate font-semibold text-xs">{user?.displayName || user?.studentId || (isAdmin ? "Administrator" : isTeacher ? "Teacher" : "Student")}</span>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <Reicon name="circle-check" size={14} isFilled /> {isAdmin ? "Admin" : isTeacher ? "Teacher" : "Active"}
                </span>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="group/sblogout flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 hover:text-rose-700 transition-colors duration-150 cursor-pointer pt-1.5 border-t border-sidebar-border/60 active:scale-95"
              >
                <Reicon name="logout" size={14} />
                <span>Sign out</span>
              </button>
            </div>

            <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center p-1">
              <SidebarMenuButton
                onClick={onLogout}
                tooltip={`Sign out (${user?.displayName || user?.studentId})`}
                className="group/sbiconlogout cursor-pointer text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl active:scale-95"
              >
                <Reicon name="logout" size={18} className="shrink-0" />
              </SidebarMenuButton>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
