import React, { useState, useEffect } from 'react';
import { apiFetch, apiJson } from '../lib/api';
import { Reicon } from './ui/reicon';
import { cn } from '../utils/cn';

interface MonitoringNoticeDialogProps {
  isOpen: boolean;
  participantId: string;
  participantName?: string;
  onConfirm: (noticeToken: string, resolvedParticipantId: string) => void;
  onCancel: () => void;
}

const COUNTDOWN_SEC = 3;

export const MonitoringNoticeDialog: React.FC<MonitoringNoticeDialogProps> = ({
  isOpen,
  participantId,
  onConfirm,
  onCancel,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SEC);
  const [noticeToken, setNoticeToken] = useState<string | null>(null);
  const [resolvedParticipantId, setResolvedParticipantId] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isOpen || !participantId) {
      setSecondsLeft(COUNTDOWN_SEC);
      setNoticeToken(null);
      setResolvedParticipantId(null);
      setTokenError(null);
      setIsLoadingToken(false);
      return;
    }

    setSecondsLeft(COUNTDOWN_SEC);
    setNoticeToken(null);
    setResolvedParticipantId(null);
    setTokenError(null);
    setIsLoadingToken(true);

    let isMounted = true;

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
          setResolvedParticipantId(
            typeof data.participantId === 'string' && data.participantId
              ? data.participantId
              : participantId
          );
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
  }, [isOpen, participantId, retryNonce]);

  if (!isOpen) return null;

  const isReady =
    secondsLeft === 0 && Boolean(noticeToken) && Boolean(resolvedParticipantId) && !isLoadingToken;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 space-y-4 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 shrink-0">
            <Reicon name="cctv" size={20} />
          </div>
          <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
            Acknowledgement
          </h3>
        </div>

        <div className="h-px bg-neutral-200/80 dark:bg-neutral-800 w-full" />

        <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed font-medium">
          Your conversations are constantly monitored for off-topic chatting and abuse. Automated
          filters block inappropriate text and images; only homework PDFs and photos may be shared.
        </p>

        {tokenError && (
          <div className="space-y-2">
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
              {tokenError}
            </div>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 underline underline-offset-2 cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}

        <div className="pt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!isReady}
            onClick={() => noticeToken && resolvedParticipantId && onConfirm(noticeToken, resolvedParticipantId)}
            className={cn(
              'min-w-[4.5rem] px-5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 flex items-center justify-center shadow-2xs',
              isReady
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 cursor-pointer font-bold'
                : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800/80 dark:text-neutral-500 cursor-not-allowed'
            )}
          >
            {isLoadingToken ? (
              <Reicon name="loader" size={14} isLoading className="animate-spin" />
            ) : secondsLeft > 0 ? (
              <span>{secondsLeft}</span>
            ) : (
              <span>OK</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
