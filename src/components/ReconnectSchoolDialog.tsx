import React, { useEffect, useRef, useState } from 'react';
import { Reicon } from './ui/reicon';
import { authService } from '../services/api';
import { cn } from '../utils/cn';
import { WanderingEyes } from "@/components/loading-ui/wandering-eyes";

interface ReconnectSchoolDialogProps {
  isOpen: boolean;
  studentId?: string | null;
  onClose: () => void;
  onReconnected: () => void;
}

/**
 * Renews the school-portal session in place.
 *
 * The app session lasts 30 days but EduSecure's own session lapses within
 * minutes, so students are regularly signed in here while homework can no
 * longer be fetched. The password is never stored, so it has to be entered
 * again - this asks for that one field instead of signing them out and making
 * them start over.
 */
export const ReconnectSchoolDialog: React.FC<ReconnectSchoolDialogProps> = ({
  isOpen,
  studentId,
  onClose,
  onReconnected,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setShowPassword(false);
      setError(null);
      setIsSubmitting(false);
      return;
    }
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 60);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const entered = password;
    if (!entered.trim()) {
      setError('Please enter your school password.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await authService.reconnectSchool(entered);
      setPassword('');
      onReconnected();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not reconnect to the school portal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconnect-title"
        className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 shrink-0">
            <Reicon name="key" size={20} />
          </div>
          <h3 id="reconnect-title" className="text-base font-bold text-neutral-900 dark:text-neutral-100">
            Reconnect to school portal
          </h3>
        </div>

        <div className="h-px bg-neutral-200/80 dark:bg-neutral-800 w-full" />

        <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
          You are still signed in. The school portal just ended its own session, which is why new
          homework stopped arriving. Enter your school password to reconnect - your password is
          never saved, so it has to be typed each time.
        </p>

        <div className="space-y-2">
          <label htmlFor="reconnect-password" className="block text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Password for {studentId || 'your school account'}
          </label>
          <div className="relative">
            <Reicon name="lock" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              ref={inputRef}
              id="reconnect-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your school password"
              disabled={isSubmitting}
              autoComplete="current-password"
              className={cn(
                'h-11 w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 pl-10 pr-11 text-sm',
                'text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 outline-none transition-colors duration-150',
                'focus:border-neutral-400 dark:focus:border-neutral-600 focus:bg-white dark:focus:bg-neutral-900',
                'disabled:opacity-50'
              )}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40"
            >
              <Reicon name={showPassword ? 'eye-off' : 'eye'} size={16} />
            </button>
          </div>
        </div>

        {error && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="pt-1 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            Not now
          </button>

          <button
            type="submit"
            disabled={isSubmitting || !password.trim()}
            className={cn(
              'min-w-[7rem] px-5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 flex items-center justify-center gap-1.5 shadow-2xs',
              isSubmitting || !password.trim()
                ? 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800/80 dark:text-neutral-500 cursor-not-allowed'
                : 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 cursor-pointer'
            )}
          >
            {isSubmitting ? (
              <>
                <WanderingEyes className="h-7" />
                <span>Reconnecting</span>
              </>
            ) : (
              <span>Reconnect</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
