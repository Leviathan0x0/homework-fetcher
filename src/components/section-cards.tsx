import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { HomeworkEntry, SessionStatus } from "../types/homework"
import { isTodayDate, isWithinLast7Days } from "../utils/dateUtils"
import { Reicon } from "@/components/ui/reicon"

interface SectionCardsProps {
  homework: HomeworkEntry[];
  completedMap: Record<string, boolean>;
  sessionStatus: SessionStatus;
}

export function SectionCards({ homework, completedMap, sessionStatus }: SectionCardsProps) {
  const todayEntries = homework.filter((item) => isTodayDate(item.date));
  const recentEntries = homework.filter((item) => isWithinLast7Days(item.date));
  const attachmentEntries = homework.filter((item) => Boolean(item.attachment));

  const getEntryId = (item: HomeworkEntry) =>
    `${item.date}_${item.homework.slice(0, 30)}`;

  const todayCompletedCount = todayEntries.filter((item) => Boolean(completedMap[getEntryId(item)])).length;
  const recentCompletedCount = recentEntries.filter((item) => Boolean(completedMap[getEntryId(item)])).length;

  const todayPercent = todayEntries.length > 0 ? Math.round((todayCompletedCount / todayEntries.length) * 100) : 0;
  const recentPercent = recentEntries.length > 0 ? Math.round((recentCompletedCount / recentEntries.length) * 100) : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Today Card */}
      <Card className="shadow-2xs border-neutral-200/80 dark:border-neutral-800 rounded-3xl">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardDescription className="text-xs font-medium">Today's tasks</CardDescription>
          <Reicon name="calendar" size={16} className="text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <CardTitle className="text-2xl font-bold">{todayEntries.length}</CardTitle>
          <div className="flex items-center gap-1.5 mt-1">
            <Badge variant="outline" className="text-[11px] font-medium border-emerald-500/40 text-emerald-600 dark:text-emerald-400 rounded-full">
              <Reicon name="circle-check" size={12} className="mr-1 text-emerald-500" />
              {todayCompletedCount} of {todayEntries.length} done ({todayPercent}%)
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Recent Card */}
      <Card className="shadow-2xs border-neutral-200/80 dark:border-neutral-800 rounded-3xl">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardDescription className="text-xs font-medium">Last 7 days</CardDescription>
          <Reicon name="clock" size={16} className="text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <CardTitle className="text-2xl font-bold">{recentEntries.length}</CardTitle>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground font-medium">
            <span>{recentCompletedCount} completed ({recentPercent}%)</span>
          </div>
        </CardContent>
      </Card>

      {/* Attachments Card */}
      <Card className="shadow-2xs border-neutral-200/80 dark:border-neutral-800 rounded-3xl">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardDescription className="text-xs font-medium">Attachments</CardDescription>
          <Reicon name="paperclip" size={16} className="text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <CardTitle className="text-2xl font-bold">{attachmentEntries.length}</CardTitle>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground font-medium">
            <span>Downloadable resources</span>
          </div>
        </CardContent>
      </Card>

      {/* Session Card */}
      <Card className="shadow-2xs border-neutral-200/80 dark:border-neutral-800 rounded-3xl">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardDescription className="text-xs font-medium">EduSecure auth</CardDescription>
          <Reicon name="shield-check" size={16} className="text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {sessionStatus === "connected" ? "Connected" : "Expired"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            HTTP-only secure session
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
