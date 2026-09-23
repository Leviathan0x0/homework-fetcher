import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { Reicon } from './ui/reicon';

export interface SubjectComboboxOption {
  value: string;
  label: string;
}

interface SubjectComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<string | SubjectComboboxOption>;
  placeholder?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

let comboboxIdCounter = 0;

/**
 * Type-to-search subject picker: an input that opens a filtered listbox on
 * focus. Keyboard: ↑/↓ move, Enter selects, Esc closes.
 */
export const SubjectCombobox: React.FC<SubjectComboboxProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Type to search subjects…',
  id,
  className,
  'aria-label': ariaLabel,
}) => {
  const listId = useMemo(() => `subject-combobox-list-${++comboboxIdCounter}`, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo<SubjectComboboxOption[]>(
    () => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
    [options]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const openList = () => {
    setOpen(true);
    setQuery('');
    setActiveIndex(Math.max(0, items.findIndex((item) => item.value === value)));
  };

  const closeList = () => {
    setOpen(false);
    setQuery('');
  };

  const selectItem = (item: SubjectComboboxOption) => {
    onChange(item.value);
    closeList();
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openList();
      else setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      else setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        event.preventDefault();
        selectItem(filtered[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        closeList();
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          autoComplete="off"
          value={open ? query : value}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={openList}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full h-11 pl-3.5 pr-10 text-xs sm:text-sm rounded-2xl border border-neutral-300/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600 focus:ring-2 focus:ring-neutral-400/20 dark:focus:ring-neutral-600/20 transition-all duration-200',
            className
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle subject list"
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) closeList();
            else {
              inputRef.current?.focus();
              openList();
            }
          }}
          className="absolute right-2.5 inset-y-0 my-auto size-6 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <Reicon name="chevron-down" size={14} className={cn('transition-transform duration-150', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-[60] left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {filtered.length === 0 ? (
            <li className="px-3.5 py-2.5 text-xs text-neutral-400">
              No subjects match “{query.trim()}”
            </li>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = item.value === value;
              return (
                <li key={item.value} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    // Keep input focus so the outside-click handler owns closing.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => selectItem(item)}
                    className={cn(
                      'w-full text-left px-3.5 py-2 text-xs sm:text-sm flex items-center justify-between gap-2 cursor-pointer transition-colors',
                      idx === activeIndex
                        ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-50'
                        : 'text-neutral-700 dark:text-neutral-300',
                      isSelected && 'font-semibold text-neutral-900 dark:text-white'
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {isSelected && <Reicon name="check" size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};
