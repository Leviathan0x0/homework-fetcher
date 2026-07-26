import React, { useState, useEffect } from 'react';
import { apiFetch, apiJson } from '../lib/api';
import { ShieldAlert, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { cn } from '../utils/cn';

interface MonitoringNoticeDialogProps {
  isOpen: boolean;
  participantId: string;
  participantName?: string;
  onConfirm: (noticeToken: string) => void;
  onCancel: () => void;
}

export const MonitoringNoticeDialog: React.FC<MonitoringNoticeDialogProps> = ({
  isOpen,
  participantId,
  participantName,
  onConfirm,
  onCancel,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [noticeToken, setNoticeToken] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !participantId) {
      setSecondsLeft(5);
      setNoticeToken(null);
      setTokenError(null);
      return;
    }

    // Reset countdown and state whenever dialog is opened
    setSecondsLeft(5);
    setNoticeToken(null);
    setTokenError(null);
    setIsLoadingToken(true);

    let isMounted = true;

    // Fetch notice token from backend
    apiFetch('/api/conversations/notice-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ participantId }),
    })
      .then((res) => apiJson<any>(res))
      .then((data) => {
        if (!isMounted) return;
        if (data.noticeToken) {
          setNoticeToken(data.noticeToken);
        } else {
          setTokenError(data.error || 'Failed to initialize session notice.');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setTokenError(err.message || 'Network error initializing notice.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingToken(false);
      });

    // Start 5-second countdown timer
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOpen, participantId]);

  if (!isOpen) return null;

  const isEnabled = secondsLeft === 0 && Boolean(noticeToken) && !isLoadingToken;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 space-y-5 relative overflow-hidden">
        {/* Header Icon & Title */}
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              Monitoring Notice
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Starting chat with <span className="font-semibold text-neutral-700 dark:text-neutral-300">{participantName || 'Student'}</span>
            </p>
          </div>
        </div>

        {/* Notice Body */}
        <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/80 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed space-y-2">
          <p className="font-semibold text-neutral-900 dark:text-neutral-100">
            School Communication Policy
          </p>
          <p>
            Conversations may be <strong>continuously monitored by school authorities</strong> for abuse, harassment, and off-topic or non-academic use.
          </p>
          <p className="text-neutral-500 dark:text-neutral-400 text-[11px]">
            Please maintain appropriate, respectful, and educational discussion at all times.
          </p>
        </div>

        {tokenError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
            {tokenError}
          </div>
        )}

        {/* Countdown Indicator */}
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 px-1">
          <span>Required confirmation pause:</span>
          {secondsLeft > 0 ? (
            <span className="font-semibold text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              {secondsLeft}s remaining
            </span>
          ) : (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              Ready
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex items-center justify-between gap-3 border-t border-neutral-100 dark:border-neutral-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <button
            type="button"
            disabled={!isEnabled}
            onClick={() => noticeToken && onConfirm(noticeToken)}
            className={cn(
              'px-5 py-2.5 rounded-2xl text-xs font-semibold transition-all duration-200 flex items-center gap-2 shadow-2xs',
              isEnabled
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 cursor-pointer'
                : 'bg-neutral-200 text-neutral-400 dark:bg-neutral-800/80 dark:text-neutral-600 cursor-not-allowed opacity-60'
            )}
          >
            {isLoadingToken ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Initializing...</span>
              </>
            ) : secondsLeft > 0 ? (
              <span>OK ({secondsLeft}s)</span>
            ) : (
              <span>OK</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
