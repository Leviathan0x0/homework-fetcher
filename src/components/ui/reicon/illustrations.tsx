import React from 'react';
import type { ReillustrationName } from './types';

export const ILLUSTRATION_REGISTRY: Record<ReillustrationName, React.ReactNode> = {
  'empty-today': (
    <g className="illustration-empty-today">
      {/* Soft ambient background aura */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100 dark:fill-neutral-800/60" />
      <circle cx="60" cy="60" r="36" className="fill-primary/5 dark:fill-primary/10" />

      {/* Floating sparkles */}
      <path
        d="M26 34l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"
        className="fill-amber-400/80 dark:fill-amber-300/80"
      />
      <path
        d="M92 30l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z"
        className="fill-primary/60 dark:fill-primary/70"
      />
      <circle cx="94" cy="82" r="2.5" className="fill-emerald-400/80" />
      <circle cx="28" cy="80" r="2" className="fill-neutral-300 dark:fill-neutral-600" />

      {/* Calendar card container */}
      <g className="translate-y-0.5">
        <rect
          x="34"
          y="36"
          width="52"
          height="52"
          rx="12"
          className="fill-white dark:fill-neutral-900 stroke-neutral-200/90 dark:stroke-neutral-700/80"
          strokeWidth="2"
        />
        {/* Calendar top header bar */}
        <path
          d="M34 48h52"
          className="stroke-neutral-200 dark:stroke-neutral-700/80"
          strokeWidth="2"
        />
        {/* Binder rings */}
        <rect x="44" y="30" width="4" height="10" rx="2" className="fill-primary" />
        <rect x="72" y="30" width="4" height="10" rx="2" className="fill-primary" />

        {/* Checkmark inside calendar */}
        <circle cx="60" cy="67" r="14" className="fill-primary/10 dark:fill-primary/20" />
        <path
          d="M54 67l4 4 8-8"
          fill="none"
          className="stroke-primary"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
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

  'empty-search': (
    <g className="illustration-empty-search">
      {/* Ambient background disc */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100/90 dark:fill-neutral-800/60" />

      {/* Concentric radar rings */}
      <circle cx="54" cy="50" r="28" fill="none" className="stroke-neutral-200/70 dark:stroke-neutral-700/50" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="54" cy="50" r="38" fill="none" className="stroke-neutral-200/50 dark:stroke-neutral-700/30" strokeWidth="1" strokeDasharray="4 4" />

      {/* Floating particles */}
      <circle cx="28" cy="40" r="3" className="fill-primary/40 dark:fill-primary/50" />
      <circle cx="86" cy="34" r="2" className="fill-amber-400" />
      <circle cx="84" cy="74" r="3.5" className="fill-indigo-400/40" />

      {/* Magnifying glass */}
      <g className="translate-x-[-2px] translate-y-[-2px]">
        <circle
          cx="52"
          cy="48"
          r="22"
          className="fill-white dark:fill-neutral-900 stroke-neutral-800 dark:stroke-neutral-200"
          strokeWidth="3"
        />
        {/* Glass lens reflection */}
        <path
          d="M40 38a16 16 0 0 1 20 0"
          fill="none"
          className="stroke-primary"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Handle */}
        <path
          d="M68 64l18 18"
          fill="none"
          className="stroke-neutral-800 dark:stroke-neutral-200"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        {/* Gentle search-x cross or question mark */}
        <path
          d="M47 43l10 10M57 43l-10 10"
          fill="none"
          className="stroke-neutral-300 dark:stroke-neutral-600"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </g>
  ),

  'empty-completed': (
    <g className="illustration-empty-completed">
      {/* Background glow & sunburst */}
      <circle cx="60" cy="60" r="48" className="fill-emerald-50/80 dark:fill-emerald-950/20" />
      <circle cx="60" cy="60" r="36" className="fill-emerald-100/50 dark:fill-emerald-900/30" />

      {/* Celebration bursts */}
      <path d="M60 14v6M60 100v6M14 60h6M100 60h6M27 27l4 4M89 89l4 4M27 93l4-4M89 31l4-4" fill="none" className="stroke-emerald-400 dark:stroke-emerald-500" strokeWidth="2" strokeLinecap="round" />

      {/* Main check badge */}
      <circle
        cx="60"
        cy="60"
        r="24"
        className="fill-emerald-500 dark:fill-emerald-500 text-white shadow-lg"
      />
      <path
        d="M50 60l7 7 14-14"
        fill="none"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

  'celebration-holiday': (
    <g className="illustration-celebration-holiday">
      {/* Warm ambient celebration aura */}
      <circle cx="60" cy="60" r="50" className="fill-rose-100/70 dark:fill-rose-950/30" />
      <circle cx="60" cy="60" r="38" className="fill-amber-100/60 dark:fill-amber-950/30" />

      {/* Confetti & sparkles */}
      <path d="M22 34l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" className="fill-amber-400" />
      <path d="M96 28l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" className="fill-rose-500" />
      <path d="M88 88l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" className="fill-indigo-500" />
      <circle cx="28" cy="82" r="3" className="fill-emerald-400" />
      <circle cx="94" cy="56" r="2.5" className="fill-amber-500" />
      <circle cx="20" cy="56" r="2" className="fill-rose-400" />

      {/* Floating party popper cone */}
      <g transform="translate(36 34)">
        <path
          d="M8 44L4 16l32 16L8 44z"
          className="fill-rose-500 stroke-rose-600 dark:stroke-rose-400"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M4 16l32 16" fill="none" className="stroke-white/80" strokeWidth="2" />
        <path d="M12 20l20 10" fill="none" className="stroke-amber-300" strokeWidth="2" />

        {/* Popper blast ribbons */}
        <path
          d="M26 12c4-8 12-6 16-2s10 4 14-2"
          fill="none"
          className="stroke-amber-400"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M32 20c6-4 12-2 16 4"
          fill="none"
          className="stroke-rose-400"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </g>
  ),

  'offline-disconnected': (
    <g className="illustration-offline-disconnected">
      {/* Ambient aura */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100 dark:fill-neutral-800/60" />

      {/* Concentric wifi signal arcs */}
      <path
        d="M26 44a48 48 0 0 1 68 0"
        fill="none"
        className="stroke-neutral-300 dark:stroke-neutral-700"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M36 56a34 34 0 0 1 48 0"
        fill="none"
        className="stroke-neutral-300 dark:stroke-neutral-700"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M46 68a20 20 0 0 1 28 0"
        fill="none"
        className="stroke-neutral-400 dark:stroke-neutral-600"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="60" cy="80" r="4" className="fill-amber-500" />

      {/* Disconnect slash */}
      <line
        x1="24"
        y1="24"
        x2="96"
        y2="96"
        className="stroke-rose-500 dark:stroke-rose-400"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </g>
  ),

  'error-warning': (
    <g className="illustration-error-warning">
      {/* Background warning aura */}
      <circle cx="60" cy="60" r="48" className="fill-rose-50/80 dark:fill-rose-950/20" />

      {/* Warning shield / triangle */}
      <path
        d="M60 22l38 60H22L60 22z"
        className="fill-white dark:fill-neutral-900 stroke-rose-500 dark:stroke-rose-400"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Exclamation mark inside */}
      <line
        x1="60"
        y1="42"
        x2="60"
        y2="58"
        className="stroke-rose-500 dark:stroke-rose-400"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="60" cy="70" r="2" className="fill-rose-500 dark:fill-rose-400" />
    </g>
  ),

  'auth-shield': (
    <g className="illustration-auth-shield">
      {/* Ambient security aura */}
      <circle cx="60" cy="60" r="48" className="fill-primary/5 dark:fill-primary/10" />

      {/* Security shield container */}
      <path
        d="M60 22c16 0 30 6 30 18v22c0 20-14 34-30 40-16-6-30-20-30-40V40c0-12 14-18 30-18z"
        className="fill-white dark:fill-neutral-900 stroke-primary"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* Inner lock mechanism */}
      <rect
        x="48"
        y="54"
        width="24"
        height="18"
        rx="4"
        className="fill-primary text-white"
      />
      <path
        d="M52 54V47a8 8 0 0 1 16 0v7"
        fill="none"
        className="stroke-primary"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="60" cy="62" r="2" fill="white" />
      <line x1="60" y1="64" x2="60" y2="67" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ),

  'exam-prep': (
    <g className="illustration-exam-prep">
      {/* Ambient backdrop */}
      <circle cx="60" cy="60" r="48" className="fill-indigo-50 dark:fill-indigo-950/30" />

      {/* Open book / test booklet */}
      <path
        d="M60 48v36M60 48c-8-6-20-6-34 0v36c14-6 26-6 34 0M60 48c8-6 20-6 34 0v36c-14-6-26-6-34 0"
        fill="none"
        className="stroke-indigo-600 dark:stroke-indigo-400 fill-white dark:fill-neutral-900"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Graduation cap floating above */}
      <g transform="translate(60 30)">
        <polygon
          points="0,-10 24,0 0,10 -24,0"
          className="fill-indigo-600 dark:fill-indigo-500 stroke-neutral-900 dark:stroke-neutral-100"
          strokeWidth="1.5"
        />
        <path d="M-12 5v10c0 4 6 7 12 7s12-3 12-7V5" fill="none" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth="1.5" />
        <path d="M24 0v12" fill="none" className="stroke-amber-400" strokeWidth="2" strokeLinecap="round" />
      </g>
    </g>
  ),

  'messages-empty-student': (
    <g className="illustration-messages-empty-student">
      {/* Ambient background aura */}
      <circle cx="60" cy="60" r="48" className="fill-sky-50 dark:fill-sky-950/30" />
      <circle cx="60" cy="60" r="36" className="fill-sky-100/50 dark:fill-sky-900/20" />

      {/* Floating accents */}
      <circle cx="26" cy="34" r="3" className="fill-amber-400" />
      <circle cx="94" cy="30" r="2.5" className="fill-emerald-400" />
      <path d="M88 84l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" className="fill-sky-500" />

      {/* Left conversation bubble */}
      <g transform="translate(24 30)">
        <path
          d="M6 0h40a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H16l-10 8v-8H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6z"
          className="fill-white dark:fill-neutral-900 stroke-neutral-200 dark:stroke-neutral-700"
          strokeWidth="2"
        />
        <circle cx="16" cy="17" r="2.5" className="fill-sky-500" />
        <circle cx="26" cy="17" r="2.5" className="fill-sky-400" />
        <circle cx="36" cy="17" r="2.5" className="fill-sky-300" />
      </g>

      {/* Right companion bubble */}
      <g transform="translate(56 50)">
        <path
          d="M4 0h32a5 5 0 0 1 5 5v16a5 5 0 0 1-5 5h-4l-6 6v-6H4a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z"
          className="fill-sky-500 text-white"
        />
        <path d="M10 13h16M10 8h10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
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

  'student-requests-empty': (
    <g className="illustration-student-requests-empty">
      <circle cx="60" cy="60" r="48" className="fill-amber-50 dark:fill-amber-950/30" />
      {/* Collaboration book & handshake */}
      <path d="M30 40h24a8 8 0 0 1 8 8v32a8 8 0 0 0-8-8H30z" className="fill-white dark:fill-neutral-900 stroke-amber-500" strokeWidth="2" />
      <path d="M90 40H66a8 8 0 0 0-8 8v32a8 8 0 0 1 8-8h24z" className="fill-white dark:fill-neutral-900 stroke-amber-500" strokeWidth="2" />
      <circle cx="60" cy="40" r="14" className="fill-amber-500 text-white shadow-sm" />
      <path d="M54 40l4 4 8-8" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),

  'classwork-empty': (
    <g className="illustration-classwork-empty">
      {/* A warm study-table vignette built from layered, theme-aware SVG art. */}
      <path d="M17 53c1-23 19-39 43-39 27 0 46 19 44 45-2 27-19 43-46 44-25 0-42-21-41-50z" className="fill-amber-50 dark:fill-amber-950/25" />
      <circle cx="88" cy="31" r="12" className="fill-sky-100 dark:fill-sky-950/70" />
      <path d="M16 88h88" className="stroke-slate-300 dark:stroke-slate-700" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M26 88l-4 17M94 88l4 17" className="stroke-slate-400 dark:stroke-slate-600" strokeWidth="3" strokeLinecap="round" />

      {/* Open ruled notebook. */}
      <path d="M25 47c13-4 24-2 35 5v34c-11-7-22-9-35-5z" className="fill-white dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-700" strokeWidth="2" strokeLinejoin="round" />
      <path d="M95 47c-13-4-24-2-35 5v34c11-7 22-9 35-5z" className="fill-white dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-700" strokeWidth="2" strokeLinejoin="round" />
      <path d="M60 52v34" className="stroke-slate-300 dark:stroke-slate-700" strokeWidth="1.5" />
      <path d="M32 58c8-1 15 0 21 3M32 65c8-1 15 0 21 3M32 72c8-1 15 0 21 3M67 60c7-3 14-4 21-2M67 67c7-3 14-4 21-2M67 74c6-2 11-3 16-2" fill="none" className="stroke-sky-300 dark:stroke-sky-700" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="69" y="42" width="16" height="16" rx="2" transform="rotate(5 77 50)" className="fill-amber-300 dark:fill-amber-500" />
      <path d="M73 48h8M73 52h6" className="stroke-amber-700 dark:stroke-amber-950" strokeWidth="1.2" strokeLinecap="round" />

      {/* Pencil resting across the page. */}
      <g transform="translate(31 81) rotate(-13)">
        <rect width="48" height="6" rx="3" className="fill-rose-400 stroke-rose-500" strokeWidth="1.2" />
        <path d="M48 0l9 3-9 3z" className="fill-amber-100 stroke-slate-600 dark:stroke-slate-400" strokeWidth="1" strokeLinejoin="round" />
        <path d="M55 2l3 1-3 1z" className="fill-slate-700 dark:fill-slate-200" />
        <rect x="4" y="0" width="5" height="6" className="fill-amber-300" />
      </g>

      {/* Upload badge ties the illustration to the classwork action. */}
      <g transform="translate(78 16)">
        <circle cx="10" cy="10" r="10" className="fill-sky-500 dark:fill-sky-600 stroke-white dark:stroke-slate-900" strokeWidth="2" />
        <path d="M10 15V6M6.5 9.5L10 6l3.5 3.5" fill="none" className="stroke-white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M22 31l1.8 3.6 3.6 1.8-3.6 1.8-1.8 3.6-1.8-3.6-3.6-1.8 3.6-1.8z" className="fill-emerald-400" />
      <circle cx="101" cy="68" r="2.5" className="fill-rose-400" />
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

  'empty-notifications': (
    <g className="illustration-empty-notifications">
      {/* Calm ambient background aura */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100/90 dark:fill-neutral-800/50" />
      <circle cx="60" cy="60" r="36" className="fill-indigo-50/50 dark:fill-indigo-950/20" />

      {/* Gentle ZZZ floating arcs */}
      <path d="M82 28h8l-8 8h8" fill="none" className="stroke-indigo-400 dark:stroke-indigo-400" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M92 20h6l-6 6h6" fill="none" className="stroke-indigo-300 dark:stroke-indigo-500" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Peaceful bell */}
      <g transform="translate(36 30)">
        <path
          d="M24 6a14 14 0 0 0-14 14v12l-4 6h36l-4-6V20A14 14 0 0 0 24 6z"
          className="fill-white dark:fill-neutral-900 stroke-neutral-800 dark:stroke-neutral-200"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="42" r="4" className="fill-amber-400 stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="1.5" />
        <circle cx="24" cy="4" r="3" className="fill-neutral-800 dark:fill-neutral-200" />
      </g>

      {/* Sparkles */}
      <circle cx="26" cy="40" r="2.5" className="fill-amber-400" />
      <circle cx="30" cy="80" r="2" className="fill-neutral-300 dark:fill-neutral-600" />
    </g>
  ),

  'welcome-student': (
    <g className="illustration-welcome-student">
      {/* Back glow */}
      <circle cx="60" cy="60" r="48" className="fill-sky-50 dark:fill-sky-950/30" />
      <circle cx="60" cy="60" r="36" className="fill-sky-100/50 dark:fill-sky-900/20" />

      {/* Student backpack */}
      <g transform="translate(38 28)">
        <rect x="4" y="12" width="36" height="42" rx="10" className="fill-sky-500 stroke-sky-600 dark:stroke-sky-400" strokeWidth="2" />
        <rect x="10" y="24" width="24" height="20" rx="6" className="fill-white dark:fill-neutral-900 stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="2" />
        <path d="M14 12V6a6 6 0 0 1 12 0v6" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="22" cy="34" r="2.5" className="fill-amber-400" />
      </g>

      {/* Floating pencil & ruler */}
      <g transform="translate(24 48) rotate(-24)">
        <rect x="0" y="0" width="6" height="30" rx="1.5" className="fill-amber-400 stroke-neutral-800 dark:stroke-neutral-900" strokeWidth="1.5" />
        <polygon points="0,30 6,30 3,36" className="fill-neutral-200 stroke-neutral-800 dark:stroke-neutral-900" strokeWidth="1" />
      </g>

      {/* Floating star */}
      <path d="M88 34l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" className="fill-amber-400" />
      <circle cx="90" cy="80" r="3" className="fill-emerald-400" />
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

  'filter-no-results': (
    <g className="illustration-filter-no-results">
      {/* Background disc */}
      <circle cx="60" cy="60" r="48" className="fill-neutral-100 dark:fill-neutral-800/60" />

      {/* Funnel shape */}
      <g transform="translate(32 26)">
        <path
          d="M4 8h48l-18 20v24l-12-6V28L4 8z"
          className="fill-white dark:fill-neutral-900 stroke-neutral-800 dark:stroke-neutral-200"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <line x1="12" y1="16" x2="44" y2="16" className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Tiny filtered particle drops */}
      <circle cx="60" cy="84" r="2.5" className="fill-primary" />
      <circle cx="60" cy="94" r="1.5" className="fill-neutral-400" />
      <circle cx="86" cy="38" r="3" className="fill-amber-400" />
    </g>
  ),

  'security-lockout': (
    <g className="illustration-security-lockout">
      {/* Aura */}
      <circle cx="60" cy="60" r="48" className="fill-rose-50/70 dark:fill-rose-950/30" />

      {/* Big padlock container */}
      <g transform="translate(36 28)">
        <path d="M12 24V14a12 12 0 0 1 24 0v10" fill="none" className="stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="3" strokeLinecap="round" />
        <rect x="4" y="24" width="40" height="34" rx="8" className="fill-rose-500 stroke-rose-600" strokeWidth="2" />
        {/* Keyhole */}
        <circle cx="24" cy="38" r="3.5" fill="white" />
        <line x1="24" y1="41.5" x2="24" y2="47" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Safety ring */}
      <circle cx="60" cy="60" r="44" fill="none" className="stroke-rose-400/50" strokeWidth="1.5" strokeDasharray="4 4" />
    </g>
  ),

  'study-desk': (
    <g className="illustration-study-desk">
      {/* Ambient background disc */}
      <circle cx="60" cy="60" r="48" className="fill-amber-50/60 dark:fill-amber-950/20" />

      {/* Stacked books */}
      <rect x="30" y="68" width="50" height="10" rx="3" className="fill-indigo-600 stroke-neutral-900 dark:stroke-neutral-100" strokeWidth="1.5" />
      <rect x="34" y="58" width="44" height="10" rx="3" className="fill-amber-500 stroke-neutral-900 dark:stroke-neutral-100" strokeWidth="1.5" />
      <rect x="38" y="48" width="38" height="10" rx="3" className="fill-emerald-500 stroke-neutral-900 dark:stroke-neutral-100" strokeWidth="1.5" />

      {/* Desk lamp shining light */}
      <g transform="translate(74 24)">
        <path d="M6 34L14 8l10 6" fill="none" className="stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="2.5" strokeLinecap="round" />
        <polygon points="20,10 32,2 26,20" className="fill-amber-400 stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="1.5" />
        {/* Cone light beam */}
        <path d="M26 20L8 50h-16L20 10" fill="none" className="stroke-amber-300/60 dark:stroke-amber-400/30" strokeWidth="1" strokeDasharray="3 3" />
      </g>
    </g>
  ),

  'exam-countdown': (
    <g className="illustration-exam-countdown">
      {/* Background glow */}
      <circle cx="60" cy="60" r="48" className="fill-indigo-50/80 dark:fill-indigo-950/30" />

      {/* Hourglass */}
      <g transform="translate(42 26)">
        <path d="M6 4h24M6 60h24" className="stroke-neutral-800 dark:stroke-neutral-200" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M8 4l10 28L8 60h20l-10-28L28 4H8z"
          className="fill-white dark:fill-neutral-900 stroke-neutral-800 dark:stroke-neutral-200"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Falling golden sand */}
        <polygon points="12,12 24,12 18,24" className="fill-amber-400" />
        <polygon points="14,54 22,54 18,44" className="fill-amber-400" />
        <line x1="18" y1="24" x2="18" y2="44" className="stroke-amber-400" strokeWidth="1.5" strokeDasharray="2 2" />
      </g>

      {/* Floating timer rings */}
      <circle cx="86" cy="38" r="3" className="fill-indigo-500" />
      <circle cx="30" cy="74" r="2.5" className="fill-amber-400" />
    </g>
  ),

  'announcements-bulletin': (
    <g className="illustration-announcements-bulletin">
      {/* Ambient background disc */}
      <circle cx="60" cy="60" r="48" className="fill-amber-50/70 dark:fill-amber-950/20" />

      {/* Wooden cork board */}
      <rect x="24" y="26" width="72" height="60" rx="8" className="fill-amber-100 dark:fill-neutral-900 stroke-amber-700 dark:stroke-neutral-700" strokeWidth="3" />

      {/* Pinned note 1 */}
      <g transform="translate(32 34) rotate(-6)">
        <rect x="0" y="0" width="26" height="24" rx="2" className="fill-amber-300 dark:fill-amber-400 shadow-sm" />
        <circle cx="13" cy="3" r="2" className="fill-rose-500" />
        <line x1="4" y1="10" x2="22" y2="10" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="4" y1="16" x2="18" y2="16" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" strokeLinecap="round" />
      </g>

      {/* Pinned note 2 */}
      <g transform="translate(62 44) rotate(4)">
        <rect x="0" y="0" width="24" height="30" rx="2" className="fill-white dark:fill-neutral-800 stroke-neutral-200 dark:stroke-neutral-700" strokeWidth="1.5" />
        <circle cx="12" cy="3" r="2" className="fill-sky-500" />
        <line x1="4" y1="12" x2="20" y2="12" className="stroke-neutral-300 dark:stroke-neutral-600" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="4" y1="18" x2="16" y2="18" className="stroke-neutral-300 dark:stroke-neutral-600" strokeWidth="1.5" strokeLinecap="round" />
      </g>
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
};
