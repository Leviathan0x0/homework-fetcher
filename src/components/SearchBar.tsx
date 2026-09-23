import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Reicon } from './ui/reicon';

export type SearchTypeFilter = 'all' | 'recent' | 'attachment' | 'completed' | 'pending';

const TYPE_FILTERS: ReadonlyArray<{ value: SearchTypeFilter; label: string; icon: Parameters<typeof Reicon>[0]['name'] }> = [
  { value: 'all', label: 'All', icon: 'layers' },
  { value: 'recent', label: 'Recent', icon: 'clock' },
  { value: 'attachment', label: 'Attachments', icon: 'paperclip' },
  { value: 'completed', label: 'Completed', icon: 'circle-check' },
  { value: 'pending', label: 'Pending', icon: 'circle-alert' },
];

export const searchTypeFilterLabel = (value: SearchTypeFilter): string =>
  TYPE_FILTERS.find((f) => f.value === value)?.label ?? 'All';

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  typeFilter?: SearchTypeFilter;
  onTypeFilterChange?: (filter: SearchTypeFilter) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  inputRef,
  typeFilter = 'all',
  onTypeFilterChange,
}) => {
  const [isHoveredOrFocused, setIsHoveredOrFocused] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRootRef = useRef<HTMLDivElement>(null);

  const hasTypeFilter = Boolean(onTypeFilterChange);
  const activeFilter = TYPE_FILTERS.find((f) => f.value === typeFilter) ?? TYPE_FILTERS[0];

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (filterRootRef.current && !filterRootRef.current.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [filtersOpen]);

  return (
    <div
      className={cn(
        'group/search relative flex-1 flex items-center gap-2 h-11 sm:h-10 pl-3.5 pr-2 rounded-xl border shadow-2xs transition-all duration-200',
        'bg-white dark:bg-[#141417] border-neutral-300/80 dark:border-neutral-800',
        'hover:border-neutral-400/70 dark:hover:border-neutral-700',
        'focus-within:border-neutral-400 dark:focus-within:border-neutral-600 focus-within:ring-2 focus-within:ring-neutral-400/15 dark:focus-within:ring-neutral-600/20 focus-within:shadow-xs'
      )}
      onMouseEnter={() => setIsHoveredOrFocused(true)}
      onMouseLeave={() => setIsHoveredOrFocused(false)}
    >
      <Reicon
        name="search"
        size={16}
        preset="zoom"
        isActive={isHoveredOrFocused}
        className="shrink-0 text-neutral-400 transition-colors duration-200 group-focus-within/search:text-neutral-700 dark:group-focus-within/search:text-neutral-200"
      />

      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setIsHoveredOrFocused(true);
          setFiltersOpen(false);
        }}
        placeholder="Search homework, classwork, requests…"
        className="app-search-input w-full min-w-0 flex-1 h-full bg-transparent border-0 outline-none px-0 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:ring-0 focus:border-0 [&::-webkit-search-cancel-button]:hidden"
      />

      {hasTypeFilter && (
        <div ref={filterRootRef} className="relative shrink-0">
          <button
            type="button"
            aria-label={`Search filters${typeFilter !== 'all' ? `: ${activeFilter.label}` : ''}`}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1.5 h-7 pl-2 pr-2 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer active:scale-95',
              typeFilter !== 'all'
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-2xs'
                : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200'
            )}
          >
            <Reicon name="filter" size={13} />
            {typeFilter !== 'all' && <span className="hidden sm:inline">{activeFilter.label}</span>}
          </button>

          {filtersOpen && onTypeFilterChange && (
            <div
              role="menu"
              aria-label="Search filters"
              className="absolute right-0 top-full mt-1.5 z-40 w-44 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] shadow-lg p-1 animate-in fade-in-0 zoom-in-95 duration-150"
            >
              {TYPE_FILTERS.map((filter) => {
                const isActive = typeFilter === filter.value;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onTypeFilterChange(filter.value);
                      setFiltersOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left',
                      isActive
                        ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 hover:text-neutral-900 dark:hover:text-neutral-100'
                    )}
                  >
                    <Reicon name={filter.icon} size={14} className={isActive ? 'opacity-100' : 'opacity-70'} />
                    <span className="flex-1">{filter.label}</span>
                    {isActive && <Reicon name="check" size={13} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {value ? (
        <div className="shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="group/clear p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded-full touch-manipulation cursor-pointer active:scale-90 transition-transform duration-150"
          >
            <Reicon name="x" size={14} className="transition-transform duration-200 group-hover/clear:rotate-90" />
          </button>
        </div>
      ) : (
        <div className="shrink-0 flex items-center pointer-events-none">
          <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 text-[10px] font-sans font-medium text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full transition-all duration-200 group-focus-within/search:opacity-50">
            /
          </kbd>
        </div>
      )}
    </div>
  );
};
