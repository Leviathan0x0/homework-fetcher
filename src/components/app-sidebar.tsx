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
import {
  Calendar,
  UploadSimple,
  Handshake,
  ChatCircleDots,
  CalendarBlank,
  GraduationCap,
  Clock,
  Stack,
  Paperclip,
  CheckCircle,
  Gear,
  SignOut,
  WarningCircle
} from "@phosphor-icons/react"

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
  const navGroups = [
    {
      label: "Main",
      items: [
        { id: "today" as ViewType, title: "Today", icon: Calendar, badge: todayCount > 0 ? todayCount : undefined },
        { id: "classwork" as ViewType, title: "Classwork", icon: UploadSimple },
        { id: "requests" as ViewType, title: "Requests", icon: Handshake },
        { id: "messages" as ViewType, title: "Messages", icon: ChatCircleDots },
      ],
    },
    {
      label: "Planning",
      items: [
        { id: "calendar" as ViewType, title: "Calendar", icon: CalendarBlank },
        { id: "exams" as ViewType, title: "Exams", icon: GraduationCap },
      ],
    },
    {
      label: "Library",
      items: [
        { id: "recent" as ViewType, title: "Recent", icon: Clock },
        { id: "all" as ViewType, title: "All homework", icon: Stack },
        { id: "attachments" as ViewType, title: "Attachments", icon: Paperclip },
        { id: "completed" as ViewType, title: "Completed", icon: CheckCircle },
      ],
    },
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="group data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <div className="flex aspect-square size-8 items-center justify-center rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 font-bold shrink-0 transition-transform duration-300 group-hover:rotate-12 shadow-2xs">
                H
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold text-xs">Homework</span>
                <span className="truncate text-[11px] text-muted-foreground">Student portal</span>
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
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        onClick={() => onViewChange(item.id)}
                        isActive={isActive}
                        tooltip={item.title}
                        className="group/sbitem cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                      >
                        <Icon size={18} weight={isActive ? "fill" : "regular"} className="shrink-0 transition-transform duration-200 group-hover/sbitem:-rotate-6" />
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
                  onClick={() => onViewChange("settings")}
                  isActive={activeView === "settings"}
                  tooltip="Settings"
                  className="group/sbset cursor-pointer text-xs transition-colors duration-150 active:scale-95"
                >
                  <Gear size={18} weight={activeView === "settings" ? "fill" : "regular"} className="shrink-0 transition-transform duration-300 group-hover/sbset:rotate-45" />
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
            {/* Full Card View when expanded */}
            <div className="p-2.5 flex flex-col gap-2 rounded-2xl bg-sidebar-accent/40 text-sidebar-accent-foreground text-xs border border-sidebar-border/40 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center justify-between">
                <span className="font-semibold truncate text-xs">{user?.studentId || "Student"}</span>
                {sessionStatus === "connected" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle size={14} weight="fill" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                    <WarningCircle size={14} weight="fill" className="animate-wiggle-subtle" /> Expired
                  </span>
                )}
              </div>
              <button
                onClick={onLogout}
                className="group/sblogout flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 hover:text-rose-700 transition-colors duration-150 cursor-pointer pt-1.5 border-t border-sidebar-border/60 active:scale-95"
              >
                <SignOut size={14} weight="regular" className="transition-transform duration-200 group-hover/sblogout:-translate-x-0.5" />
                <span>Sign out</span>
              </button>
            </div>

            {/* Icon Only Button when collapsed */}
            <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center p-1">
              <SidebarMenuButton
                onClick={onLogout}
                tooltip={`Sign out (${user?.studentId || "Student"})`}
                className="group/sbiconlogout cursor-pointer text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl active:scale-95"
              >
                <SignOut size={18} weight="regular" className="shrink-0 transition-transform duration-200 group-hover/sbiconlogout:-translate-x-0.5" />
              </SidebarMenuButton>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
