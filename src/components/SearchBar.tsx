import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const SearchBar: React.FC<SearchBarProps> = ({ value, onChange, inputRef }) => {
  return (
    <div className="relative flex-1 group/search">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none transition-colors duration-200 group-focus-within/search:text-neutral-700 dark:group-focus-within/search:text-neutral-200" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search text, subject, date..."
        className="w-full h-11 sm:h-10 pl-11 pr-10 bg-white dark:bg-[#141417] border border-neutral-200/80 dark:border-neutral-800 rounded-full text-sm sm:text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600 focus:ring-2 focus:ring-neutral-400/20 dark:focus:ring-neutral-600/20 transition-all duration-200 shadow-2xs"
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          className="group/clear absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded-full touch-manipulation cursor-pointer active:scale-90 transition-transform duration-150"
        >
          <X className="w-4 h-4 sm:w-3.5 sm:h-3.5 transition-transform duration-200 group-hover/clear:rotate-90" />
        </button>
      ) : (
        <kbd className="hidden sm:block absolute right-3.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[10px] font-mono font-medium text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full pointer-events-none transition-all duration-200 group-focus-within/search:opacity-50">
          /
        </kbd>
      )}
    </div>
  );
};
