import React, { useState, useEffect, useMemo } from 'react';
import type { HomeworkEntry, ViewType, SchoolCalendarEvent } from '../types/homework';
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
import { Reicon } from './ui/reicon';

interface TodayViewProps {
  homework: HomeworkEntry[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh: (force?: boolean) => void;
  lastUpdated: string | null;
  completedMap: Record<string, boolean>;
  onToggleCompleted: (id: string) => void;
  onUpdateNote?: (id: string, note: string | null) => void;
  onOpenPreview?: (url: string, filename?: string) => void;
  displayName?: string | null;
  studentId?: string | null;
  hasHomeworkError?: boolean;
  unreadMessages?: number;
  openRequests?: number;
  onNavigate?: (view: ViewType) => void;
}

function fullNameFrom(displayName?: string | null, studentId?: string | null): string {
  const raw = (displayName || studentId || '').trim();
  if (!raw) return 'there';
  return raw.replace(/\s+/g, ' ');
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
  if (total === 0) return 'Nothing due today — enjoy the quiet.';
  if (done === 0) return 'Start with one — momentum builds fast.';
  if (done >= total) return 'All done for today. Nice work.';
  if (done / total >= 0.66) return 'Almost there — keep going.';
  return 'Keep going — you are making progress.';
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
  unreadMessages = 0,
  openRequests = 0,
  onNavigate,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('All');
  const [alerts, setAlerts] = useState<Array<{ id: number | string; title: string; message: string; level: 'info' | 'warning' | 'urgent' }>>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>(readDismissedAlerts);
  const [teacherAssignments, setTeacherAssignments] = useState<Array<{ targetId: string; title: string; subject: string; dueDate: string; status: string; attachmentUrl?: string; attachmentFilename?: string; attachmentMimeType?: string }>>([]);
  const [animatedGlance, setAnimatedGlance] = useState<string | null>(null);

  const {
    events: calendarEvents,
    isLoading: holidaysLoading,
    reload: reloadHolidays,
  } = useSchoolCalendar();

  const todayHolidays = useMemo(() => {
    const todayYmd = formatYmd(new Date());
    return (calendarEvents || []).filter(
      (e: SchoolCalendarEvent) => e.date === todayYmd && e.selected !== false
    );
  }, [calendarEvents]);

  const upcomingHoliday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const future = (calendarEvents || [])
      .filter((e: SchoolCalendarEvent) => e.selected !== false)
      .map((e: SchoolCalendarEvent) => {
        const [y, m, d] = e.date.split('-').map(Number);
        const eventDate = new Date(y, m - 1, d);
        const diffMs = eventDate.getTime() - today.getTime();
        const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return { event: e, daysAway };
      })
      .filter((item) => item.daysAway > 0 && item.daysAway <= 7)
      .sort((a, b) => a.daysAway - b.daysAway);
    return future[0] || null;
  }, [calendarEvents]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminService.getActiveAlerts();
        if (!cancelled && res?.alerts && Array.isArray(res.alerts)) {
          setAlerts(res.alerts);
        }
      } catch {
        // Soft fail
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await teacherService.getStudentAssignments();
        if (!cancelled && Array.isArray(list)) {
          setTeacherAssignments(list.slice(0, 3));
        }
      } catch {
        // Soft fail
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissAlert = (id: string) => {
    setDismissedAlerts((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => !dismissedAlerts.includes(String(a.id))),
    [alerts, dismissedAlerts]
  );

  const greeting = getTimeGreeting();
  const name = fullNameFrom(displayName, studentId);
  const dateStr = formatContextualDate();

  const todayEntries = useMemo(() => {
    const safeHomework = Array.isArray(homework) ? homework : [];
    return safeHomework.filter((item) => {
      if (!item) return false;
      const itemDate = item.date ? item.date.trim() : '';
      return itemDate ? isTodayDate(itemDate) : false;
    });
  }, [homework]);

  const availableSubjects = useMemo(() => {
    return Array.from(
      new Set(todayEntries.map((item) => detectSubject(item?.homework || '').name))
    );
  }, [todayEntries]);

  const filteredEntries = useMemo(() => {
    if (selectedSubject === 'All') return todayEntries;
    return todayEntries.filter(
      (item) => detectSubject(item?.homework || '').name === selectedSubject
    );
  }, [todayEntries, selectedSubject]);

  const getEntryId = (item: HomeworkEntry) => item.id || `${item.date}_${item.homework}`;
  const totalCount = todayEntries.length;
  const completedCount = todayEntries.filter((item) => completedMap[getEntryId(item)]).length;
  const pendingCount = Math.max(0, totalCount - completedCount);
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const encouragement = progressEncouragement(completedCount, totalCount);

  const hasHolidayToday = todayHolidays.length > 0;
  const isContentLoading = isLoading || (Boolean(isRefreshing) && filteredEntries.length === 0);

  const subtitle = hasHolidayToday
    ? 'School is off today.'
    : totalCount === 0
      ? 'No homework posted today yet.'
      : completedCount >= totalCount
        ? 'All caught up for today!'
        : `${pendingCount} ${pendingCount === 1 ? 'task' : 'tasks'} remaining today.`;

  const glance = [
    {
      key: 'homework',
      label: pendingCount === 1 ? 'task' : 'tasks',
      value: isContentLoading ? '...' : String(pendingCount),
      iconName: 'calendar-check' as const,
      preset: 'bounce' as const,
      onClick: undefined as undefined | (() => void),
    },
    {
      key: 'messages',
      label: unreadMessages === 1 ? 'chat' : 'chats',
      value: String(unreadMessages),
      iconName: 'chat-line' as const,
      preset: 'bounce' as const,
      onClick: onNavigate ? () => onNavigate('messages') : undefined,
    },
    {
      key: 'requests',
      label: openRequests === 1 ? 'request' : 'requests',
      value: String(openRequests),
      iconName: 'heart-handshake' as const,
      preset: 'scale' as const,
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
          <Reicon name="bell" size={16} preset="ring" className="size-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5 min-w-0 flex-1">
            <p className="font-semibold">{alt.title}</p>
            <p className="leading-relaxed opacity-90">{alt.message}</p>
          </div>
          <button
            type="button"
            onClick={() => dismissAlert(String(alt.id))}
            aria-label={`Dismiss announcement: ${alt.title}`}
            title="Dismiss"
            className="-m-1 shrink-0 cursor-pointer rounded-lg p-1 opacity-60 transition-[background-color,opacity] duration-200 hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/10"
          >
            <Reicon name="x" size={16} preset="scale" />
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
                    <a
                      href={assignment.attachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-700 hover:underline dark:text-neutral-300"
                    >
                      <Reicon name="paperclip" size={12} className="size-3" />
                      {assignment.attachmentFilename || 'Open attachment'}
                    </a>
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
        <HolidayCard
          event={upcomingHoliday.event}
          daysAway={upcomingHoliday.daysAway}
          variant="upcoming"
          onSelect={() => onNavigate?.('calendar')}
        />
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {glance.map((item) => {
          const interactive = Boolean(item.onClick);
          const Comp: 'button' | 'div' = interactive ? 'button' : 'div';
          const isActive = animatedGlance === item.key;
          return (
            <Comp
              key={item.key}
              type={interactive ? 'button' : undefined}
              onClick={() => {
                setAnimatedGlance(null);
                requestAnimationFrame(() => setAnimatedGlance(item.key));
                item.onClick?.();
              }}
              onMouseEnter={() => setAnimatedGlance(item.key)}
              onMouseLeave={() => setAnimatedGlance(null)}
              onFocus={() => setAnimatedGlance(item.key)}
              onBlur={() => setAnimatedGlance(null)}
              aria-label={`${item.value} ${item.label}`}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-2xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50/80 p-2.5 text-left shadow-2xs dark:border-neutral-800/80 dark:from-[#18181b] dark:to-[#111113]',
                interactive &&
                  'cursor-pointer hover:border-neutral-300 dark:hover:border-neutral-700 transition-all active:scale-[0.98]'
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-neutral-200/70 bg-white/80 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 max-[359px]:hidden">
                <Reicon name={item.iconName} size={14} preset={item.preset} isActive={isActive} />
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
              Today’s progress
            </h2>
            <span className="text-xs font-semibold tabular-nums text-neutral-500 dark:text-neutral-400">
              {completedCount} of {totalCount} done ({progressPercent}%)
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Today's homework completion progress"
            className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
          >
            <div
              style={{ width: `${progressPercent}%` }}
              className="h-full rounded-full bg-neutral-900 dark:bg-white transition-[width] duration-500 ease-out"
            />
          </div>

          <p className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">
            {encouragement}
          </p>
        </section>
      )}

      {availableSubjects.length > 1 && (
        <SubjectFilterPills
          subjects={availableSubjects}
          selectedSubject={selectedSubject}
          onSelectSubject={setSelectedSubject}
        />
      )}

      {isContentLoading ? (
        <LoadingSkeleton label="Loading today's homework…" />
      ) : filteredEntries.length === 0 ? (
        hasHolidayToday ? null : (
          <EmptyState
            type="today"
            title="No homework posted today"
            subtitle="Nothing has been sent yet. Check back later or refresh when your school posts it."
          />
        )
      ) : (
        <div className="space-y-3.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {filteredEntries.map((item, index) => {
            const entryId = getEntryId(item);
            return (
              <HomeworkCard
                key={item.id || index}
                item={item}
                isCompleted={Boolean(completedMap[entryId])}
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
