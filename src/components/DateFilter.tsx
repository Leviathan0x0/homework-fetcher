import React from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';

interface DateFilterProps {
  value: string;
  onChange: (val: string) => void;
}

export const DateFilter: React.FC<DateFilterProps> = ({ value, onChange }) => {
  return (
    <div className="relative flex items-center w-full sm:w-auto group/datefilter">
      <div className="relative flex items-center bg-white dark:bg-[#18181b] border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 sm:px-2.5 h-10 sm:h-9 w-full sm:w-auto transition-all duration-200 focus-within:border-neutral-400 dark:focus-within:border-neutral-600 focus-within:ring-2 focus-within:ring-neutral-400/20">
        <CalendarIcon className="w-4 h-4 text-neutral-400 mr-2 shrink-0 pointer-events-none transition-transform duration-200 group-focus-within/datefilter:rotate-6" />
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-transparent border-none text-sm sm:text-xs text-neutral-900 dark:text-neutral-100 outline-none cursor-pointer pr-1 w-full sm:w-auto"
          title="Filter by date"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="group/clear ml-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 rounded-full touch-manipulation cursor-pointer active:scale-90 transition-transform duration-150"
            title="Clear date filter"
          >
            <X className="w-4 h-4 sm:w-3.5 sm:h-3.5 transition-transform duration-200 group-hover/clear:rotate-90" />
          </button>
        )}
      </div>
    </div>
  );
};
