import React, { useEffect } from 'react';
import { ExternalLink, KeyRound, School, X } from 'lucide-react';
import { EDUSECURE_CHANGE_PASSWORD_URL, EDUSECURE_LOGIN_URL } from '../utils/schoolPortal';
import { cn } from '../utils/cn';

export type PasswordHelpVariant = 'forgot' | 'change';

interface ForgotPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** `forgot` for the login page; `change` for signed-in settings. */
  variant?: PasswordHelpVariant;
  /** Softens the dialog chrome for the always-dark login screen. */
  appearance?: 'default' | 'login';
}

/**
 * Explains why this app cannot email a reset link, and points students to the
 * school office / EduSecure portal — the only places that can change the
 * password used at sign-in.
 */
export const ForgotPasswordDialog: React.FC<ForgotPasswordDialogProps> = ({
  isOpen,
  onClose,
  variant = 'forgot',
  appearance = 'default',
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isForgot = variant === 'forgot';
  const isLoginLook = appearance === 'login';
  const portalUrl = isForgot ? EDUSECURE_LOGIN_URL : EDUSECURE_CHANGE_PASSWORD_URL;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        'pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]',
        isLoginLook ? 'bg-black/70 backdrop-blur-sm' : 'bg-black/60 backdrop-blur-xs',
        'animate-in fade-in duration-200'
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-help-title"
        className={cn(
          'w-full max-w-md space-y-4 rounded-3xl border p-6 shadow-2xl',
          isLoginLook
            ? 'border-white/15 bg-[#141417] text-[#f5f2eb]'
            : 'border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-[#141417] dark:text-neutral-100'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'shrink-0 rounded-2xl p-2.5',
                isLoginLook
                  ? 'bg-white/10 text-[#f5f2eb]'
                  : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
              )}
            >
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="password-help-title"
                className={cn(
                  'text-base font-bold',
                  isLoginLook
                    ? 'text-[#f8f5ee]'
                    : 'text-neutral-900 dark:text-neutral-100'
                )}
              >
                {isForgot ? 'Forgot password?' : 'School password'}
              </h3>
              <p
                className={cn(
                  'mt-0.5 text-[11px]',
                  isLoginLook
                    ? 'text-[#f5f2eb]/55'
                    : 'text-neutral-500 dark:text-neutral-400'
                )}
              >
                Managed by EduSecure, not this app
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              'rounded-full p-1 transition-colors cursor-pointer',
              isLoginLook
                ? 'text-[#f5f2eb]/50 hover:text-[#f8f5ee] hover:bg-white/10'
                : 'text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800'
            )}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className={cn(
            'h-px w-full',
            isLoginLook
              ? 'bg-white/10'
              : 'bg-neutral-200/80 dark:bg-neutral-800'
          )}
        />

        <p
          className={cn(
            'text-xs leading-relaxed',
            isLoginLook
              ? 'text-[#f5f2eb]/70'
              : 'text-neutral-600 dark:text-neutral-300'
          )}
        >
          Your sign-in password is your school EduSecure password. This portal
          checks it with the school and never saves it, so we cannot email a
          reset link or change it from here.
        </p>

        <ol
          className={cn(
            'space-y-2.5 rounded-2xl border p-3.5 text-xs leading-relaxed',
            isLoginLook
              ? 'border-white/10 bg-black/25 text-[#f5f2eb]/75'
              : 'border-neutral-200/80 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300'
          )}
        >
          <li className="flex gap-2.5">
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                isLoginLook
                  ? 'bg-white/10 text-[#f5f2eb]'
                  : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
              )}
            >
              1
            </span>
            <span>
              {isForgot
                ? 'Ask the school office or IT desk to reset your EduSecure password for your student or teacher ID.'
                : 'To change it, sign in on the school portal and use Change Password — or ask the school office / IT desk.'}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                isLoginLook
                  ? 'bg-white/10 text-[#f5f2eb]'
                  : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
              )}
            >
              2
            </span>
            <span>
              {isForgot
                ? 'Once they give you the new password, return here and sign in with that password.'
                : 'After EduSecure updates it, use the new password the next time you sign in or reconnect here.'}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                isLoginLook
                  ? 'bg-white/10 text-[#f5f2eb]'
                  : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
              )}
            >
              3
            </span>
            <span className="inline-flex items-start gap-1.5">
              <School className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
              <span>
                Admin and demo teacher accounts use deployment passwords — those
                are rotated by whoever hosts this app, not by EduSecure.
              </span>
            </span>
          </li>
        </ol>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'rounded-xl px-4 py-2 text-xs font-semibold transition-colors cursor-pointer',
              isLoginLook
                ? 'text-[#f5f2eb]/70 hover:bg-white/10 hover:text-[#f8f5ee]'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
            )}
          >
            Got it
          </button>

          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-colors cursor-pointer',
              isLoginLook
                ? 'bg-[#f5f2eb] text-[#111114] hover:bg-white'
                : 'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200'
            )}
          >
            <span>{isForgot ? 'Open school portal' : 'Open change password'}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
