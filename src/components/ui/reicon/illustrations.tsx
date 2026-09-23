import React from 'react';
import type { IllustrationEntry, ReillustrationName } from './types';

import emptyToday from '../../../../Illustrations/undraw_empty-mailbox_ef0e.svg';
import emptyRecent from '../../../../Illustrations/undraw_files-missing_ntwe.svg';
import emptySearch from '../../../../Illustrations/undraw_searching-everywhere_tffi.svg';
import emptyCompleted from '../../../../Illustrations/undraw_checklist_bwxa.svg';
import examPrep from '../../../../Illustrations/undraw_exam-prep_nmly.svg';
import errorWarning from '../../../../Illustrations/undraw_warning_tl76.svg';
import circularsEmpty from '../../../../Illustrations/undraw_no-data_ig65.svg';
import importantEmpty from '../../../../Illustrations/undraw_confidential-letter_k1ni.svg';
import celebrationHoliday from '../../../../Illustrations/undraw_festivities_q090.svg';
import emptyNotifications from '../../../../Illustrations/undraw_fresh-notification_hnv2.svg';
import classworkEmpty from '../../../../Illustrations/undraw_files-uploading_qf8u.svg';
import studentRequestsEmpty from '../../../../Illustrations/undraw_looking-for-answers_5p23.svg';
import messagesEmptyStudent from '../../../../Illustrations/undraw_message-sent_iyz6.svg';
import offlineDisconnected from '../../../../Illustrations/undraw_connection-lost_am29.svg';
import authShield from '../../../../Illustrations/undraw_secure-login_m11a.svg';
import welcomeStudent from '../../../../Illustrations/undraw_welcome_nk8k.svg';
import filterNoResults from '../../../../Illustrations/undraw_searching_pqji.svg';
import securityLockout from '../../../../Illustrations/undraw_blocked_ldel.svg';
import studyDesk from '../../../../Illustrations/undraw_studying_n5uj.svg';
import examCountdown from '../../../../Illustrations/undraw_the-right-time_n3ys.svg';
import announcementsBulletin from '../../../../Illustrations/undraw_happy-announcement_23nf.svg';
import constructionWorkers from '../../../../Illustrations/undraw_construction-workers_z99i.svg';
import workInProgress from '../../../../Illustrations/undraw_work-in-progress_m95a.svg';
import pageNotFound from '../../../../Illustrations/undraw_page-not-found_6wni.svg';

import emptyTodayDark from '../../../../Illustrations/dark/undraw_empty-mailbox_ef0e.svg';
import emptyRecentDark from '../../../../Illustrations/dark/undraw_files-missing_ntwe.svg';
import emptySearchDark from '../../../../Illustrations/dark/undraw_searching-everywhere_tffi.svg';
import emptyCompletedDark from '../../../../Illustrations/dark/undraw_checklist_bwxa.svg';
import examPrepDark from '../../../../Illustrations/dark/undraw_exam-prep_nmly.svg';
import errorWarningDark from '../../../../Illustrations/dark/undraw_warning_tl76.svg';
import circularsEmptyDark from '../../../../Illustrations/dark/undraw_no-data_ig65.svg';
import importantEmptyDark from '../../../../Illustrations/dark/undraw_confidential-letter_k1ni.svg';
import celebrationHolidayDark from '../../../../Illustrations/dark/undraw_festivities_q090.svg';
import emptyNotificationsDark from '../../../../Illustrations/dark/undraw_fresh-notification_hnv2.svg';
import classworkEmptyDark from '../../../../Illustrations/dark/undraw_files-uploading_qf8u.svg';
import studentRequestsEmptyDark from '../../../../Illustrations/dark/undraw_looking-for-answers_5p23.svg';
import messagesEmptyStudentDark from '../../../../Illustrations/dark/undraw_message-sent_iyz6.svg';
import offlineDisconnectedDark from '../../../../Illustrations/dark/undraw_connection-lost_am29.svg';
import authShieldDark from '../../../../Illustrations/dark/undraw_secure-login_m11a.svg';
import welcomeStudentDark from '../../../../Illustrations/dark/undraw_welcome_nk8k.svg';
import filterNoResultsDark from '../../../../Illustrations/dark/undraw_searching_pqji.svg';
import securityLockoutDark from '../../../../Illustrations/dark/undraw_blocked_ldel.svg';
import studyDeskDark from '../../../../Illustrations/dark/undraw_studying_n5uj.svg';
import examCountdownDark from '../../../../Illustrations/dark/undraw_the-right-time_n3ys.svg';
import announcementsBulletinDark from '../../../../Illustrations/dark/undraw_happy-announcement_23nf.svg';
import constructionWorkersDark from '../../../../Illustrations/dark/undraw_construction-workers_z99i.svg';
import workInProgressDark from '../../../../Illustrations/dark/undraw_work-in-progress_m95a.svg';
import pageNotFoundDark from '../../../../Illustrations/dark/undraw_page-not-found_6wni.svg';

type FileIllustration = { src: string; darkSrc: string };

const FILE_ILLUSTRATIONS = {
  'empty-today': { src: emptyToday, darkSrc: emptyTodayDark },
  'empty-recent': { src: emptyRecent, darkSrc: emptyRecentDark },
  'empty-search': { src: emptySearch, darkSrc: emptySearchDark },
  'empty-completed': { src: emptyCompleted, darkSrc: emptyCompletedDark },
  'exam-prep': { src: examPrep, darkSrc: examPrepDark },
  'error-warning': { src: errorWarning, darkSrc: errorWarningDark },
  'circulars-empty': { src: circularsEmpty, darkSrc: circularsEmptyDark },
  'important-empty': { src: importantEmpty, darkSrc: importantEmptyDark },
  'celebration-holiday': { src: celebrationHoliday, darkSrc: celebrationHolidayDark },
  'empty-notifications': { src: emptyNotifications, darkSrc: emptyNotificationsDark },
  'classwork-empty': { src: classworkEmpty, darkSrc: classworkEmptyDark },
  'student-requests-empty': { src: studentRequestsEmpty, darkSrc: studentRequestsEmptyDark },
  'messages-empty-student': { src: messagesEmptyStudent, darkSrc: messagesEmptyStudentDark },
  'offline-disconnected': { src: offlineDisconnected, darkSrc: offlineDisconnectedDark },
  'auth-shield': { src: authShield, darkSrc: authShieldDark },
  'welcome-student': { src: welcomeStudent, darkSrc: welcomeStudentDark },
  'filter-no-results': { src: filterNoResults, darkSrc: filterNoResultsDark },
  'security-lockout': { src: securityLockout, darkSrc: securityLockoutDark },
  'study-desk': { src: studyDesk, darkSrc: studyDeskDark },
  'exam-countdown': { src: examCountdown, darkSrc: examCountdownDark },
  'announcements-bulletin': { src: announcementsBulletin, darkSrc: announcementsBulletinDark },
  'construction-workers': { src: constructionWorkers, darkSrc: constructionWorkersDark },
  'work-in-progress': { src: workInProgress, darkSrc: workInProgressDark },
  'page-not-found': { src: pageNotFound, darkSrc: pageNotFoundDark },
} satisfies Partial<Record<ReillustrationName, FileIllustration>>;

const HAND_DRAWN_ILLUSTRATIONS = {
  'empty-attachments': (
    <g className="illustration-empty-attachments">
      {/* A small, complete file-desk scene rather than a single placeholder icon. */}
      <path d="M18 48c4-22 24-34 45-32 23 2 40 18 41 42 1 22-16 41-42 44-25 3-49-17-44-54z" className="fill-sky-50 dark:fill-sky-950/30" />
      <ellipse cx="61" cy="99" rx="39" ry="5" className="fill-slate-200/70 dark:fill-slate-800/70" />

      {/* Files peeking out of the open folder. */}
      <g transform="rotate(-8 48 55)">
        <rect x="28" y="27" width="39" height="51" rx="5" className="fill-white dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-700" strokeWidth="1.8" />
        <path d="M54 27v12h13" className="fill-sky-100 dark:fill-sky-900 stroke-slate-300 dark:stroke-slate-700" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M36 48h21M36 55h17M36 62h20" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g transform="rotate(7 74 54)">
        <rect x="57" y="25" width="35" height="48" rx="5" className="fill-white dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-700" strokeWidth="1.8" />
        <rect x="63" y="33" width="23" height="17" rx="3" className="fill-amber-100 dark:fill-amber-950/60" />
        <circle cx="79" cy="38" r="3" className="fill-amber-400" />
        <path d="M64 48l7-7 5 5 4-3 6 7" className="fill-sky-300 dark:fill-sky-700 stroke-sky-500 dark:stroke-sky-500" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M64 58h20M64 64h13" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Open folder, with a dimensional front flap. */}
      <path d="M20 52a6 6 0 0 1 6-6h25l7 7h34a7 7 0 0 1 7 7v28H20z" className="fill-sky-500 dark:fill-sky-700 stroke-sky-600 dark:stroke-sky-500" strokeWidth="2" strokeLinejoin="round" />
      <path d="M21 64h30l7-7h38a5 5 0 0 1 5 6l-7 28a7 7 0 0 1-7 5H31a7 7 0 0 1-7-6z" className="fill-sky-400 dark:fill-sky-600 stroke-sky-600 dark:stroke-sky-500" strokeWidth="2" strokeLinejoin="round" />
      <path d="M31 72h58" className="stroke-white/50" strokeWidth="2" strokeLinecap="round" />

      {/* Paperclip and floating file-type accents. */}
      <path d="M52 72v12a7 7 0 0 0 14 0V70a5 5 0 0 0-10 0v12a3 3 0 0 0 6 0v-9" fill="none" className="stroke-white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(91 29) rotate(9)">
        <rect width="18" height="20" rx="5" className="fill-indigo-500 stroke-white dark:stroke-slate-900" strokeWidth="1.5" />
        <path d="M6 6h6M6 10h6M6 14h4" className="stroke-white" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <path d="M22 31l1.7 3.5 3.5 1.7-3.5 1.7-1.7 3.5-1.7-3.5-3.5-1.7 3.5-1.7z" className="fill-amber-400" />
      <circle cx="99" cy="78" r="3" className="fill-emerald-400" />
    </g>
  ),

  'empty-assignments': (
    <g className="illustration-empty-assignments">
      {/* Background shadow & aura */}
      <ellipse cx="60" cy="98" rx="42" ry="6" className="fill-neutral-200/60 dark:fill-neutral-800/40" />
      <circle cx="60" cy="56" r="44" className="fill-neutral-100/80 dark:fill-neutral-800/50" />

      {/* Back document card */}
      <rect
        x="30"
        y="30"
        width="44"
        height="56"
        rx="8"
        transform="rotate(-8 52 58)"
        className="fill-neutral-50 dark:fill-neutral-800/90 stroke-neutral-300/80 dark:stroke-neutral-700"
        strokeWidth="2"
      />

      {/* Front primary document card */}
      <rect
        x="42"
        y="24"
        width="46"
        height="60"
        rx="8"
        className="fill-white dark:fill-neutral-900 stroke-neutral-200 dark:stroke-neutral-700"
        strokeWidth="2"
      />

      {/* Document content lines */}
      <line x1="52" y1="38" x2="78" y2="38" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="52" y1="48" x2="72" y2="48" className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" strokeLinecap="round" />
      <line x1="52" y1="56" x2="76" y2="56" className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" strokeLinecap="round" />
      <line x1="52" y1="64" x2="66" y2="64" className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" strokeLinecap="round" />

      {/* Floating pencil */}
      <g transform="translate(80 62) rotate(35)">
        <rect x="0" y="0" width="8" height="24" rx="2" className="fill-amber-400 dark:fill-amber-500 stroke-neutral-800 dark:stroke-neutral-900" strokeWidth="1.5" />
        <polygon points="0,24 8,24 4,30" className="fill-neutral-200 dark:fill-neutral-400 stroke-neutral-800 dark:stroke-neutral-900" strokeWidth="1.5" />
        <polygon points="2,27 6,27 4,30" className="fill-neutral-800 dark:fill-neutral-900" />
      </g>
    </g>
  ),

  'empty-notices': (
    <g className="illustration-empty-notices">
      {/* Background aura */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100 dark:fill-neutral-800/50" />

      {/* Soundwave arcs */}
      <path
        d="M74 46a16 16 0 0 1 0 28M82 40a24 24 0 0 1 0 40"
        fill="none"
        className="stroke-primary/60 dark:stroke-primary/70"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Megaphone body */}
      <g transform="translate(24 32)">
        <path
          d="M6 22h10l16-12v36l-16-12H6a2 2 0 0 1-2-2V24a2 2 0 0 1 2-2z"
          className="fill-white dark:fill-neutral-900 stroke-neutral-800 dark:stroke-neutral-200"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* Megaphone handle */}
        <path
          d="M12 34v10a4 4 0 0 0 4 4h2"
          fill="none"
          className="stroke-neutral-800 dark:stroke-neutral-200"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
    </g>
  ),

  'messages-empty-teacher': (
    <g className="illustration-messages-empty-teacher">
      {/* Ambient background aura */}
      <circle cx="60" cy="60" r="48" className="fill-emerald-50 dark:fill-emerald-950/30" />
      <circle cx="60" cy="60" r="36" className="fill-emerald-100/50 dark:fill-emerald-900/20" />

      {/* Faculty communication ledger / folder */}
      <rect
        x="32"
        y="30"
        width="56"
        height="64"
        rx="10"
        className="fill-white dark:fill-neutral-900 stroke-neutral-200 dark:stroke-neutral-700"
        strokeWidth="2"
      />
      <path d="M32 44h56" className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" />

      {/* Star / Verified seal badge */}
      <g transform="translate(60 62)">
        <circle cx="0" cy="0" r="14" className="fill-emerald-500 text-white" />
        <path d="M0 -6l1.8 3.8 4.2.6-3 3 .7 4.2L0 3.6 -3.7 5.6l.7-4.2-3-3 4.2-.6z" fill="white" />
      </g>

      {/* Parent-teacher chat indicator */}
      <g transform="translate(68 22)">
        <circle cx="12" cy="12" r="14" className="fill-amber-400 text-neutral-900 shadow-sm" />
        <path d="M7 12h10M12 7v10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </g>
    </g>
  ),

  'messages-empty-admin': (
    <g className="illustration-messages-empty-admin">
      {/* Ambient aura */}
      <circle cx="60" cy="60" r="48" className="fill-violet-50 dark:fill-violet-950/30" />
      <circle cx="60" cy="60" r="36" className="fill-violet-100/50 dark:fill-violet-900/20" />

      {/* Broadcast beacon / antenna */}
      <circle cx="60" cy="40" r="8" className="fill-violet-600 text-white" />
      <path d="M60 48v36M50 84h20" fill="none" className="stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="2.5" strokeLinecap="round" />

      {/* Signal waves */}
      <path d="M46 32a20 20 0 0 0 0 16M74 32a20 20 0 0 1 0 16" fill="none" className="stroke-violet-500" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M38 24a32 32 0 0 0 0 32M82 24a32 32 0 0 1 0 32" fill="none" className="stroke-violet-400/70" strokeWidth="2" strokeLinecap="round" />

      {/* System shield badge */}
      <g transform="translate(60 76)">
        <circle cx="0" cy="0" r="10" className="fill-neutral-900 dark:fill-white text-white dark:text-neutral-900" />
        <path d="M-3 0l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </g>
    </g>
  ),

  'teacher-overview-empty': (
    <g className="illustration-teacher-overview-empty">
      <circle cx="60" cy="60" r="48" className="fill-emerald-50/70 dark:fill-emerald-950/30" />
      {/* Chalkboard / Class console */}
      <rect x="26" y="28" width="68" height="48" rx="8" className="fill-neutral-800 stroke-neutral-600" strokeWidth="3" />
      <rect x="32" y="34" width="56" height="36" rx="4" className="fill-emerald-900/90" />
      <line x1="38" y1="44" x2="62" y2="44" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      <line x1="38" y1="52" x2="54" y2="52" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="38" y1="60" x2="72" y2="60" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      {/* Chalk ledge */}
      <rect x="22" y="76" width="76" height="6" rx="3" className="fill-amber-600" />
    </g>
  ),

  'admin-overview-empty': (
    <g className="illustration-admin-overview-empty">
      <circle cx="60" cy="60" r="48" className="fill-neutral-100 dark:fill-neutral-800/60" />
      {/* Console monitor frame */}
      <rect x="24" y="26" width="72" height="52" rx="10" className="fill-white dark:fill-neutral-900 stroke-neutral-300 dark:stroke-neutral-700" strokeWidth="2.5" />
      <line x1="60" y1="78" x2="60" y2="92" className="stroke-neutral-400 dark:stroke-neutral-600" strokeWidth="3" strokeLinecap="round" />
      <line x1="44" y1="92" x2="76" y2="92" className="stroke-neutral-400 dark:stroke-neutral-600" strokeWidth="3" strokeLinecap="round" />
      {/* Live pulse waveform inside */}
      <path d="M34 52h10l4-10 6 20 6-14 4 6h12" fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),

  'empty-leave': (
    <g className="illustration-empty-leave">
      {/* Ambient background disc */}
      <circle cx="60" cy="60" r="48" className="fill-amber-50/90 dark:fill-amber-950/30" />
      <circle cx="60" cy="60" r="36" className="fill-amber-100/40 dark:fill-amber-900/20" />

      {/* Floating vacation passport / ticket */}
      <g transform="translate(30 32) rotate(-8)">
        <rect x="0" y="0" width="40" height="52" rx="8" className="fill-white dark:fill-neutral-900 stroke-neutral-300 dark:stroke-neutral-700" strokeWidth="2" />
        <line x1="8" y1="12" x2="32" y2="12" className="stroke-amber-400" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="8" y1="20" x2="24" y2="20" className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" strokeLinecap="round" />
        <line x1="8" y1="28" x2="28" y2="28" className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Floating suitcase / badge with plane */}
      <g transform="translate(56 46) rotate(6)">
        <rect x="0" y="0" width="38" height="30" rx="6" className="fill-amber-500 stroke-amber-600" strokeWidth="2" />
        <path d="M12 0v-4a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v4" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <path d="M19 8v14M10 15h18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Sparkles */}
      <circle cx="24" cy="28" r="2.5" className="fill-amber-400" />
      <circle cx="92" cy="36" r="3" className="fill-emerald-400" />
      <path d="M88 78l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" className="fill-amber-500" />
    </g>
  ),

  'welcome-teacher': (
    <g className="illustration-welcome-teacher">
      {/* Back glow */}
      <circle cx="60" cy="60" r="48" className="fill-emerald-50 dark:fill-emerald-950/30" />

      {/* Teacher lecture desk & notebook */}
      <rect x="24" y="44" width="72" height="40" rx="8" className="fill-white dark:fill-neutral-900 stroke-neutral-300 dark:stroke-neutral-700" strokeWidth="2" />
      <line x1="24" y1="56" x2="96" y2="56" className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" />

      {/* Apple on desk */}
      <g transform="translate(36 32)">
        <circle cx="8" cy="8" r="8" className="fill-rose-500" />
        <path d="M8 0c0 4 4 4 4 4" fill="none" className="stroke-emerald-600" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Lesson plan binder */}
      <g transform="translate(62 26) rotate(8)">
        <rect x="0" y="0" width="26" height="32" rx="4" className="fill-emerald-500 stroke-emerald-600" strokeWidth="2" />
        <line x1="6" y1="8" x2="20" y2="8" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="14" x2="16" y2="14" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </g>
    </g>
  ),

  'welcome-admin': (
    <g className="illustration-welcome-admin">
      {/* Background glow */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100 dark:fill-neutral-800/60" />
      <circle cx="60" cy="60" r="36" className="fill-violet-50/70 dark:fill-violet-950/30" />

      {/* Command hub shield */}
      <g transform="translate(38 24)">
        <path
          d="M22 4L4 12v18c0 14 10 24 18 28 8-4 18-14 18-28V12L22 4z"
          className="fill-white dark:fill-neutral-900 stroke-violet-600 dark:stroke-violet-400"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* Core telemetry lines */}
        <circle cx="22" cy="28" r="8" className="fill-violet-600 text-white" />
        <path d="M18 28l3 3 6-6" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Satellite data nodes */}
      <circle cx="24" cy="46" r="4" className="fill-violet-400/80" />
      <circle cx="96" cy="46" r="4" className="fill-violet-400/80" />
      <line x1="28" y1="46" x2="38" y2="46" className="stroke-violet-300 dark:stroke-violet-700" strokeWidth="1.5" strokeDasharray="2 2" />
      <line x1="82" y1="46" x2="92" y2="46" className="stroke-violet-300 dark:stroke-violet-700" strokeWidth="1.5" strokeDasharray="2 2" />
    </g>
  ),

  'streak-celebration': (
    <g className="illustration-streak-celebration">
      {/* Glowing burst */}
      <circle cx="60" cy="60" r="48" className="fill-amber-50 dark:fill-amber-950/30" />
      <circle cx="60" cy="60" r="36" className="fill-orange-100/50 dark:fill-orange-950/20" />

      {/* Burning streak flame */}
      <path
        d="M60 20c8 10 18 16 18 30 0 12-8 22-18 22s-18-10-18-22c0-8 6-16 10-22 0 6 4 10 8 10 0-8 0-14 0-18z"
        className="fill-amber-500 stroke-amber-600"
        strokeWidth="2"
      />
      {/* Inner flame core */}
      <path
        d="M60 48c4 4 8 8 8 14 0 6-4 10-8 10s-8-4-8-10c0-4 4-8 8-14z"
        className="fill-amber-200 text-amber-900"
      />

      {/* Radiating sparkles */}
      <path d="M26 36l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" className="fill-amber-400" />
      <path d="M94 36l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" className="fill-amber-400" />
      <circle cx="30" cy="80" r="3" className="fill-rose-400" />
      <circle cx="90" cy="80" r="3" className="fill-emerald-400" />
    </g>
  ),

  'maintenance-tuning': (
    <g className="illustration-maintenance-tuning">
      {/* Background aura */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100 dark:fill-neutral-800/60" />

      {/* Rotating gear 1 */}
      <g transform="translate(46 42)">
        <circle cx="14" cy="14" r="14" className="fill-neutral-200 dark:fill-neutral-700 stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="2" />
        <circle cx="14" cy="14" r="6" className="fill-white dark:fill-neutral-900" />
        <path d="M14 0v4M14 24v4M0 14h4M24 14h4M4 4l3 3M21 21l3 3M4 24l3-3M21 7l3-3" className="stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="2.5" strokeLinecap="round" />
      </g>

      {/* Crossed wrench & tool */}
      <g transform="translate(68 62) rotate(45)">
        <rect x="0" y="0" width="6" height="28" rx="2" className="fill-primary" />
        <circle cx="3" cy="2" r="5" fill="none" className="stroke-primary" strokeWidth="2" />
      </g>
    </g>
  ),
} satisfies Partial<Record<ReillustrationName, React.ReactNode>>;

type UncoveredIllustration = Exclude<
  ReillustrationName,
  keyof typeof FILE_ILLUSTRATIONS | keyof typeof HAND_DRAWN_ILLUSTRATIONS
>;

// Compile-time guard: every illustration name must have file or hand-drawn art.
const _allIllustrationsCovered: UncoveredIllustration extends never ? true : never = true;
void _allIllustrationsCovered;

function buildRegistry(): Record<ReillustrationName, IllustrationEntry> {
  const registry = {} as Record<ReillustrationName, IllustrationEntry>;

  for (const [name, { src, darkSrc }] of Object.entries(FILE_ILLUSTRATIONS)) {
    registry[name as ReillustrationName] = { kind: 'file', src, darkSrc };
  }
  for (const [name, node] of Object.entries(HAND_DRAWN_ILLUSTRATIONS)) {
    registry[name as ReillustrationName] = { kind: 'svg', node };
  }

  return registry;
}

export const ILLUSTRATION_REGISTRY: Record<ReillustrationName, IllustrationEntry> = buildRegistry();
