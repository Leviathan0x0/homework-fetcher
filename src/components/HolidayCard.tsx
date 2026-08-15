import React from 'react';
import { SchoolCalendarEvent } from '../types/homework';
import { cn } from '../utils/cn';

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

function formatMonth(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short' });
}

function typeLabel(type?: string) {
  return isHolidayType(type) ? 'School Holiday' : type || 'School Event';
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
          'flex items-center gap-3 rounded-2xl border border-rose-200/60 bg-rose-50/50 px-4 py-3.5 shadow-2xs',
          'dark:border-rose-900/40 dark:bg-rose-950/20',
          className
        )}
        aria-label={`${label}: ${event.title}`}
      >
        <div className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-rose-200/70 bg-white/70 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <span className="text-[8px] font-semibold uppercase tracking-wide opacity-75">
            {formatMonth(event.date)}
          </span>
          <span className="mt-0.5 text-sm font-bold leading-none tabular-nums">
            {Number(event.date.slice(8)) || '-'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-rose-600/80 dark:text-rose-400">
            {label} · Today
          </p>
          <h2 className="mt-0.5 text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
            {event.title}
          </h2>
          <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            No classes today · {formatHolidayDate(event.date)}
          </p>
        </div>
      </section>
    );
  }

  if (variant === 'compact') {
    const Row = onSelect ? 'button' : 'div';
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors duration-200',
          active && visible && 'bg-neutral-50 dark:bg-neutral-900/50',
          !visible && 'opacity-45',
          className
        )}
      >
        <Row
          type={onSelect ? 'button' : undefined}
          onClick={onSelect}
          className={cn(
            'min-w-0 flex-1 flex items-center gap-2.5 text-left',
            onSelect && 'cursor-pointer rounded-lg'
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
            {Number(event.date.slice(8)) || '-'}
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
              'shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium cursor-pointer transition-colors duration-200',
              visible
                ? 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
            )}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    );
  }

  // detail
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-rose-200/60 bg-rose-50/50 px-3.5 py-3 shadow-2xs',
        'dark:border-rose-900/40 dark:bg-rose-950/20',
        className
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-300">
        <span className="text-xs font-bold tabular-nums">
          {Number(event.date.slice(8)) || '-'}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold text-rose-600/80 dark:text-rose-400">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
          {event.title}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          {formatHolidayDate(event.date)}
        </p>
      </div>
      {onToggleVisible && (
        <button
          type="button"
          onClick={onToggleVisible}
          className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-[11px] text-neutral-400 transition-colors duration-200 hover:bg-rose-500/10 hover:text-neutral-700 dark:hover:text-neutral-200"
          title="Hide this holiday"
        >
          Hide
        </button>
      )}
    </div>
  );
};

export { isHolidayType, formatHolidayDate };
