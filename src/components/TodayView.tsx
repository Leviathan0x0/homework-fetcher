import React, { useState, useEffect, useMemo } from 'react';
import { HomeworkEntry, ViewType } from '../types/homework';
import { isTodayDate, formatContextualDate, getTimeGreeting, formatYmd } from '../utils/dateUtils';
import { detectSubject } from '../utils/subjectDetector';
import { HomeworkCard } from './HomeworkCard';
import { HolidayCard } from './HolidayCard';
import { SubjectFilterPills } from './SubjectFilterPills';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { RefreshButton } from './RefreshButton';
import { ScrollToTopButton } from './ScrollToTopButton';
import { useSchoolCalendar } from '../hooks/useSchoolCalendar';
import { adminService, teacherService } from '../services/api';
import { cn } from '../utils/cn';
import { ClipboardList, MessageSquare, Handshake, Bell, Paperclip, X } from 'lucide-react';
import { AnimatedIcon } from './ui/animated-icon';

interface TodayViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh: (force?: boolean) => void;
  lastUpdated: string | null;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string) => void;
  displayName?: string | null;
  studentId?: string | null;
  hasHomeworkError?: boolean;
  unreadMessages?: number;
  openRequests?: number;
  onNavigate?: (view: ViewType) => void;
}

function firstNameFrom(displayName?: string | null, studentId?: string | null): string {
  const raw = (displayName || studentId || '').trim();
  if (!raw) return 'there';
  const token = raw.split(/[\s@._-]+/).filter(Boolean)[0] || raw;
  const cleaned = token.replace(/\d+$/, '') || token;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Broadcasts the student has already closed.
 *
 * Kept in localStorage so a dismissed announcement does not come back on the
 * next visit; an administrator posting a new alert gets a new id, so it still
 * shows up.
 */
const DISMISSED_ALERTS_KEY = 'dismissedBroadcastAlerts';

function readDismissedAlerts(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_ALERTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function progressEncouragement(done: number, total: number): string {
  if (total === 0) return 'Nothing due today - enjoy the quiet.';
  if (done === 0) return 'Start with one - momentum builds fast.';
  if (done >= total) return 'All done for today. Nice work.';
  if (done / total >= 0.66) return 'Almost there - keep going.';
  return 'Keep going - you are making progress.';
}

export const TodayView: React.FC<TodayViewProps> = ({
  homework,
  isLoading,
  isRefreshing,
  onRefresh,
  completedMap,
  onToggleCompleted,
  onUpdateNote,
  onOpenPreview,
  displayName,
  studentId,
  hasHomeworkError = false,
  unreadMessages = 0,
  openRequests = 0,
  onNavigate,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');
  const [activeAlerts, setActiveAlerts] = useState<any[]>([]);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>(readDismissedAlerts);
  const [teacherAssignments, setTeacherAssignments] = useState<any[]>([]);

  useEffect(() => {
    adminService.getActiveAlerts().then((res) => {
      if (res.alerts) setActiveAlerts(res.alerts);
    });
    teacherService.getStudentAssignments().then((res) => {
      if (res.assignments) setTeacherAssignments(res.assignments.slice(0, 3));
    }).catch(() => {});
  }, []);

  const dismissAlert = (alertId: string) => {
    setDismissedAlertIds((previous) => {
      if (previous.includes(alertId)) return previous;
      const next = [...previous, alertId];
      try {
        localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const visibleAlerts = useMemo(
    () => activeAlerts.filter((alert) => !dismissedAlertIds.includes(String(alert.id))),
    [activeAlerts, dismissedAlertIds]
  );

  const { events: calendarEvents, isLoading: holidaysLoading, reload: reloadHolidays } =
    useSchoolCalendar();

  const todayYmd = useMemo(() => formatYmd(new Date()), []);
  const todayHolidays = useMemo(
    () => calendarEvents.filter((e) => e.date === todayYmd && e.selected !== false),
    [calendarEvents, todayYmd]
  );
  const hasHolidayToday = todayHolidays.length > 0;

  const upcomingHoliday = useMemo(() => {
    if (hasHolidayToday) return null;
    const upcoming = calendarEvents
      .filter((e) => e.selected !== false && e.date > todayYmd)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!upcoming.length) return null;
    const next = upcoming[0];
    const [y, m, d] = next.date.split('-').map(Number);
    const daysAway = Math.round(
      (new Date(y, m - 1, d).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000
    );
    if (daysAway > 7) return null;
    return { event: next, daysAway };
  }, [calendarEvents, todayYmd, hasHolidayToday]);

  const validHomework = Array.isArray(homework) ? homework.filter(Boolean) : [];
  const todayAllEntries = validHomework.filter((item) => isTodayDate(item?.date));

  const availableSubjects = Array.from(
    new Set(todayAllEntries.map((item) => detectSubject(item?.homework || '').name))
  );

  const todayEntries =
    selectedSubject === 'All'
      ? todayAllEntries
      : todayAllEntries.filter((item) => detectSubject(item?.homework || '').name === selectedSubject);

  const getEntryId = (item: HomeworkEntry) => {
    if (!item) return '';
    const d = item.date || '';
    const hw = item.homework || '';
    return item.id || `${d}_${detectSubject(hw).name}_${hw.slice(0, 30)}`;
  };

  const isEntryDone = (item: HomeworkEntry) => {
    const entryId = getEntryId(item);
    return Boolean(completedMap[entryId]) || item.completed === true;
  };

  const doneCount = todayAllEntries.filter(isEntryDone).length;
  const totalCount = todayAllEntries.length;
  const progressPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
  // Holidays can replace the homework empty state, so an empty diary is not a
  // final answer until both requests have settled. Existing homework remains
  // visible while holidays refresh in the background.
  const isContentLoading =
    isLoading ||
    (totalCount === 0 && Boolean(isRefreshing)) ||
    (totalCount === 0 && holidaysLoading && calendarEvents.length === 0);

  const greeting = getTimeGreeting();
  const name = firstNameFrom(displayName, studentId);
  const dateStr = formatContextualDate();
  const pendingCount = Math.max(totalCount - doneCount, 0);
  const allDone = !isContentLoading && totalCount > 0 && doneCount >= totalCount;

  const subtitle = hasHomeworkError
    ? 'We could not check today’s homework yet. Try again in a moment.'
    : isContentLoading
    ? 'Preparing your dashboard...'
    : hasHolidayToday && totalCount === 0
      ? 'School holiday today. No homework is expected.'
      : hasHolidayToday && totalCount > 0
        ? 'A few assigned tasks still need your attention today.'
        : totalCount === 0
          ? 'No homework posted today.'
          : allDone
            ? 'Everything assigned for today is complete.'
            : 'Here is your plan for today.';

  const glance = [
    {
      key: 'homework',
      label: pendingCount === 1 ? 'task' : 'tasks',
      value: isContentLoading ? '...' : String(pendingCount),
      icon: ClipboardList,
      onClick: undefined as undefined | (() => void),
    },
    {
      key: 'messages',
      label: unreadMessages === 1 ? 'chat' : 'chats',
      value: String(unreadMessages),
      icon: MessageSquare,
      onClick: onNavigate ? () => onNavigate('messages') : undefined,
    },
    {
      key: 'requests',
      label: openRequests === 1 ? 'request' : 'requests',
      value: String(openRequests),
      icon: Handshake,
      onClick: onNavigate ? () => onNavigate('requests') : undefined,
    },
  ];

  const handleRefresh = () => {
    onRefresh(true);
    reloadHolidays(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 pb-5 border-b border-neutral-200/70 dark:border-neutral-800/70 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5">{dateStr}</p>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            <span
              aria-hidden
              className="mr-1.5 [font-family:'Apple_Color_Emoji','Segoe_UI_Emoji','Noto_Color_Emoji',sans-serif]"
            >
              👋
            </span>
            {greeting}, {name}
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed">
            {subtitle}
          </p>
        </div>
        <div className="shrink-0 sm:pt-0.5">
          <RefreshButton
            onRefresh={handleRefresh}
            isRefreshing={isLoading || isRefreshing || holidaysLoading}
          />
        </div>
      </div>

      {visibleAlerts.map((alt) => (
        <div
          key={alt.id}
          className={cn(
            'p-4 rounded-2xl border flex items-start gap-3 text-xs shadow-2xs',
            alt.level === 'urgent'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'
              : alt.level === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
              : 'bg-sky-500/10 border-sky-500/30 text-sky-900 dark:text-sky-200'
          )}
        >
          <Bell className="size-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0 flex-1">
            <p className="font-semibold">{alt.title}</p>
            <p className="leading-relaxed opacity-90">{alt.message}</p>
          </div>
          <button
            type="button"
            onClick={() => dismissAlert(String(alt.id))}
            aria-label={`Dismiss announcement: ${alt.title}`}
            title="Dismiss"
            className="-m-1 shrink-0 rounded-lg p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}

      {teacherAssignments.length > 0 && (
        <section
          className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-2xs dark:border-neutral-800 dark:bg-[#141417]"
          aria-label="Teacher assignments"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">From your teachers</h2>
              <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">New assignments shared with your class.</p>
            </div>
          </div>
          <div className="space-y-2">
            {teacherAssignments.map((assignment) => (
              <div key={assignment.targetId} className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-950/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{assignment.title}</p>
                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{assignment.subject} · due {assignment.dueDate}</p>
                  </div>
                  <span className="rounded-md bg-neutral-200/70 px-2 py-1 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{assignment.status}</span>
                </div>
                {assignment.attachmentUrl && (
                  assignment.attachmentMimeType?.startsWith('audio/') ? (
                    <audio className="mt-3 w-full" controls src={assignment.attachmentUrl} />
                  ) : (
                    <a href={assignment.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-700 hover:underline dark:text-neutral-300"><Paperclip className="size-3" />{assignment.attachmentFilename || 'Open attachment'}</a>
                  )
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {todayHolidays.map((event) => (
        <HolidayCard key={event.id} event={event} variant="hero" />
      ))}

      {!hasHolidayToday && upcomingHoliday && (
        <button
          type="button"
          onClick={() => onNavigate?.('calendar')}
          className="w-full text-left rounded-2xl border border-rose-200/60 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-950/20 px-4 py-3.5 flex items-center gap-3 cursor-pointer hover:border-rose-300 dark:hover:border-rose-800 transition-colors active:scale-[0.99] shadow-2xs"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-300">
            <span className="text-xs font-bold tabular-nums">
              {Number(upcomingHoliday.event.date.slice(8))}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600/80 dark:text-rose-400">
              {upcomingHoliday.daysAway === 1
                ? 'Holiday tomorrow'
                : `Holiday in ${upcomingHoliday.daysAway} days`}
            </p>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate mt-0.5">
              {upcomingHoliday.event.title}
            </p>
          </div>
          <span className="text-[11px] text-rose-600 dark:text-rose-400 shrink-0 font-medium">
            View
          </span>
        </button>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {glance.map((item) => {
          const Icon = item.icon;
          const interactive = Boolean(item.onClick);
          const Comp: 'button' | 'div' = interactive ? 'button' : 'div';
          return (
            <Comp
              key={item.key}
              type={interactive ? 'button' : undefined}
              onClick={item.onClick}
              aria-label={`${item.value} ${item.label}`}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-2xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50/80 p-2.5 text-left shadow-2xs dark:border-neutral-800/80 dark:from-[#18181b] dark:to-[#111113]',
                interactive &&
                  'cursor-pointer hover:border-neutral-300 dark:hover:border-neutral-700 transition-all active:scale-[0.98]'
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-neutral-200/70 bg-white/80 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 max-[359px]:hidden">
                <AnimatedIcon icon={Icon} preset={item.key === 'messages' ? 'bounce' : item.key === 'requests' ? 'shake' : 'scale'} size={14} />
              </span>
              <span className="flex min-w-0 items-baseline gap-1">
                <span className="text-base sm:text-lg font-semibold tabular-nums tracking-tight text-neutral-900 dark:text-neutral-50 leading-none">
                  {item.value}
                </span>
                <span className="truncate text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug max-[359px]:sr-only">
                  {item.label}
                </span>
              </span>
            </Comp>
          );
        })}
      </div>

      {!isContentLoading && totalCount > 0 && (
        <section
          className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white dark:bg-[#141417] p-4 sm:p-5 shadow-2xs animate-in fade-in-0 duration-300"
          aria-label="Today's progress"
        >
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
              Today’s Progress
            </h2>
            <p className="text-xs font-semibold tabular-nums text-neutral-600 dark:text-neutral-300">
              {progressPct}% complete
            </p>
          </div>
          <div
            className="h-2.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={totalCount}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500 ease-out',
                allDone ? 'bg-emerald-500' : 'bg-neutral-500 dark:bg-neutral-500'
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">
            {progressEncouragement(doneCount, totalCount)}
          </p>
        </section>
      )}

      {(availableSubjects.length > 0 || todayEntries.length > 0) && (
        <SubjectFilterPills
          subjects={availableSubjects}
          selectedSubject={selectedSubject}
          onSelectSubject={setSelectedSubject}
        />
      )}

      {isContentLoading ? (
        <LoadingSkeleton label="Loading today’s homework…" />
      ) : todayEntries.length === 0 ? (
        hasHolidayToday || hasHomeworkError
          ? null
          : <EmptyState
              type="today"
              title="No homework posted today"
              subtitle="Nothing has been sent yet. Check back later or refresh when your school posts it."
            />
      ) : (
        <div className="space-y-2.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {todayEntries.map((item, index) => {
            const entryId = getEntryId(item);
            return (
              <HomeworkCard
                key={item.id || index}
                item={item}
                isCompleted={isEntryDone(item)}
                onToggleCompleted={() => onToggleCompleted(entryId)}
                onUpdateNote={onUpdateNote}
                onOpenPreview={onOpenPreview}
              />
            );
          })}
        </div>
      )}
      <ScrollToTopButton />
    </div>
  );
};
