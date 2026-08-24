import React from 'react';
import type { SchoolCalendarEvent } from '../types/homework';
import { cn } from '../utils/cn';
import { Reicon, Reillustration } from './ui/reicon';

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
          'relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl border border-rose-200/70 bg-gradient-to-br from-rose-50/80 via-rose-50/40 to-amber-50/50 p-5 sm:p-6 shadow-xs',
          'dark:border-rose-900/40 dark:from-rose-950/30 dark:via-rose-950/15 dark:to-neutral-900/40',
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

        <div className="relative flex items-start gap-4 min-w-0 flex-1">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-sm shadow-rose-500/25">
            <Reicon name="party-popper" size={22} preset="bounce" className="text-white" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 dark:bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                <Reicon name="sparkles" size={12} preset="scale" className="text-rose-600 dark:text-rose-400" />
                {label}
              </span>
              <span className="text-xs tabular-nums font-medium text-neutral-500 dark:text-neutral-400">
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

        <div className="hidden sm:flex shrink-0 items-center justify-center">
          <Reillustration name="celebration-holiday" size="sm" interactive />
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
              'inline-flex items-center gap-1 shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium cursor-pointer transition-colors duration-200',
              visible
                ? 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
            )}
          >
            <Reicon name={visible ? 'eye' : 'eye-off'} size={12} preset="scale" />
            <span>{visible ? 'On' : 'Off'}</span>
          </button>
        )}
      </div>
    );
  }

  // detail
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-rose-200/60 bg-rose-50/50 px-3.5 py-3 shadow-2xs',
        'dark:border-rose-900/40 dark:bg-rose-950/20',
        className
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-sm shadow-rose-500/20">
        <Reicon name="party-popper" size={18} preset="bounce" className="text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-50 leading-snug">
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
