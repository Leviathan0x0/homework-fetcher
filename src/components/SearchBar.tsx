import React, { useState } from 'react';
import { Reicon } from './ui/reicon';

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const SearchBar: React.FC<SearchBarProps> = ({ value, onChange, inputRef }) => {
  const [isHoveredOrFocused, setIsHoveredOrFocused] = useState(false);

  return (
    <div
      className="relative flex-1 group/search"
      onMouseEnter={() => setIsHoveredOrFocused(true)}
      onMouseLeave={() => setIsHoveredOrFocused(false)}
    >
      <div className="absolute left-4 inset-y-0 flex items-center justify-center pointer-events-none transition-colors duration-200 group-focus-within/search:text-neutral-700 dark:group-focus-within/search:text-neutral-200 text-neutral-400">
        <Reicon name="search" size={16} preset="zoom" isActive={isHoveredOrFocused} />
      </div>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsHoveredOrFocused(true)}
        onBlur={() => setIsHoveredOrFocused(false)}
        placeholder="Search homework, classwork, requests…"
        className="w-full h-11 sm:h-10 pl-11 pr-10 bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800 rounded-full text-sm sm:text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600 focus:ring-2 focus:ring-neutral-400/20 dark:focus:ring-neutral-600/20 transition-all duration-200 shadow-2xs"
      />
      {value ? (
        <div className="absolute right-3 inset-y-0 flex items-center justify-center">
          <button
            type="button"
            onClick={() => onChange('')}
            className="group/clear p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded-full touch-manipulation cursor-pointer active:scale-90 transition-transform duration-150"
          >
            <Reicon name="x" size={14} className="transition-transform duration-200 group-hover/clear:rotate-90" />
          </button>
        </div>
      ) : (
        <div className="absolute right-3.5 inset-y-0 flex items-center justify-center pointer-events-none">
          <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 text-[10px] font-sans font-medium text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full transition-all duration-200 group-focus-within/search:opacity-50">
            /
          </kbd>
        </div>
      )}
    </div>
  );
};
