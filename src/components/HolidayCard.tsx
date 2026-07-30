import React from 'react';
import { SchoolCalendarEvent } from '../types/homework';
import { cn } from '../utils/cn';
import { PartyPopper, Sparkles, EyeOff, Eye } from 'lucide-react';

function isHolidayType(type?: string) {
  return /holiday|vacation|break|off/i.test(type || '');
}

function formatHolidayDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function typeLabel(type?: string) {
  return isHolidayType(type) ? 'School holiday' : type || 'School event';
}

interface HolidayCardProps {
  event: SchoolCalendarEvent;
  /** hero = Today page banner, detail = calendar day, compact = month list row */
  variant?: 'hero' | 'detail' | 'compact';
  active?: boolean;
  onSelect?: () => void;
  onToggleVisible?: () => void;
  className?: string;
}

export const HolidayCard: React.FC<HolidayCardProps> = ({
  event,
  variant = 'detail',
  active = false,
  onSelect,
  onToggleVisible,
  className,
}) => {
  const visible = event.selected !== false;
  const label = typeLabel(event.type);

  if (variant === 'hero') {
    return (
      <section
        className={cn(
          'relative overflow-hidden rounded-2xl border border-rose-200/80 dark:border-rose-900/50',
          'bg-gradient-to-br from-rose-50 via-white to-amber-50/80',
          'dark:from-rose-950/40 dark:via-[#141417] dark:to-amber-950/20',
          'p-4 sm:p-5 shadow-2xs',
          className
        )}
        aria-label={`${label}: ${event.title}`}
      >
        <div
          className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-rose-400/15 dark:bg-rose-500/10 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-amber-300/20 dark:bg-amber-500/10 blur-2xl"
          aria-hidden
        />

        <div className="relative flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-sm shadow-rose-500/25">
            <PartyPopper className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                <Sparkles className="h-3 w-3" />
                {label}
              </span>
              <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                {formatHolidayDate(event.date)}
              </span>
            </div>
            <h2 className="mt-1.5 text-base sm:text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 leading-snug">
              {event.title}
            </h2>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              No school today — enjoy the break.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'compact') {
    const Row = onSelect ? 'button' : 'div';
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors',
          active && visible && 'bg-rose-50 dark:bg-rose-950/35',
          !visible && 'opacity-45',
          className
        )}
      >
        <Row
          type={onSelect ? 'button' : undefined}
          onClick={onSelect}
          className={cn(
            'min-w-0 flex-1 flex items-center gap-2.5 text-left',
            onSelect && 'cursor-pointer'
          )}
        >
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-lg text-[10px] font-bold leading-none tabular-nums',
              visible
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400'
            )}
          >
            {Number(event.date.slice(8)) || '—'}
          </span>
          <span className="min-w-0">
            <span
              className={cn(
                'block text-xs font-medium truncate',
                visible
                  ? 'text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-500 line-through'
              )}
            >
              {event.title}
            </span>
            <span className="block text-[10px] text-neutral-400 mt-0.5">
              {formatShortDate(event.date)} · {isHolidayType(event.type) ? 'Holiday' : event.type}
            </span>
          </span>
        </Row>
        {onToggleVisible && (
          <button
            type="button"
            onClick={onToggleVisible}
            title={visible ? 'Hide on calendar' : 'Show on calendar'}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium cursor-pointer transition-colors',
              visible
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/15'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            )}
          >
            {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {visible ? 'On' : 'Off'}
          </button>
        )}
      </div>
    );
  }

  // detail
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-rose-200/70 dark:border-rose-900/45',
        'bg-gradient-to-r from-rose-50/90 to-white dark:from-rose-950/30 dark:to-[#141417]',
        'px-4 py-3.5 shadow-2xs',
        className
      )}
    >
      <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-sm shadow-rose-500/20">
          <PartyPopper className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            {label}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-50 leading-snug">
            {event.title}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {formatHolidayDate(event.date)}
          </p>
        </div>
        {onToggleVisible && (
          <button
            type="button"
            onClick={onToggleVisible}
            className="shrink-0 text-[11px] text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
            title="Hide this holiday"
          >
            Hide
          </button>
        )}
      </div>
    </div>
  );
};

export { isHolidayType, formatHolidayDate };
