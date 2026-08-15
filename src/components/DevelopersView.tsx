import React from 'react';
import { Code2, Github, Globe, Linkedin } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { PageHeader } from './PageHeader';
import { DEVELOPERS, DEVELOPERS_PROJECT, DeveloperLink, DeveloperLinkKind } from '../data/developers';
import { cn } from '../utils/cn';

const LINK_TONES: Record<DeveloperLinkKind, string> = {
  website: 'text-sky-600 dark:text-sky-400',
  x: 'text-violet-600 dark:text-violet-400',
  github: 'text-indigo-600 dark:text-indigo-400',
  linkedin: 'text-blue-600 dark:text-blue-400',
  devto: 'text-emerald-600 dark:text-emerald-400',
  other: 'text-amber-600 dark:text-amber-400',
};

function LinkIcon({ kind }: { kind: DeveloperLinkKind }) {
  const className = cn('size-3.5 shrink-0', LINK_TONES[kind]);
  switch (kind) {
    case 'github':
      return <Github className={className} aria-hidden />;
    case 'website':
      return <Globe className={className} aria-hidden />;
    case 'linkedin':
      return <Linkedin className={className} aria-hidden />;
    case 'devto':
      return <Code2 className={className} aria-hidden />;
    case 'x':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.725-8.835L1.254 2.25H8.08l4.251 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    default:
      return null;
  }
}

function ConnectionLink({ link, reduceMotion }: { link: DeveloperLink; reduceMotion: boolean }) {
  return (
    <motion.a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={reduceMotion ? undefined : { y: -1 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className={cn(
        'group/link inline-flex cursor-pointer items-center gap-1.5 py-1 text-xs font-medium',
        'text-neutral-600 transition-colors duration-200 hover:text-violet-700',
        'focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40',
        'dark:text-neutral-400 dark:hover:text-violet-300'
      )}
    >
      <LinkIcon kind={link.kind} />
      <span className="border-b border-neutral-200 pb-0.5 transition-colors duration-200 group-hover/link:border-violet-400 dark:border-neutral-800 dark:group-hover/link:border-violet-500">
        {link.label}
      </span>
    </motion.a>
  );
}

export const DevelopersView: React.FC = () => {
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = Boolean(prefersReducedMotion);
  const reveal = (delay = 0) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div className="max-w-5xl space-y-8 sm:space-y-10">
      <motion.div {...reveal()}>
        <PageHeader title="Meet the Developers" description={DEVELOPERS_PROJECT.blurb} />
      </motion.div>

      <motion.section
        {...reveal(0.04)}
        className="relative pb-7 sm:pb-9"
        aria-labelledby="shared-credit-title"
      >
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-6 rounded-full bg-gradient-to-r from-sky-500 via-violet-500 to-emerald-500"
            aria-hidden
          />
          <p className="text-xs font-medium text-violet-700 dark:text-violet-300">Built together</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(18rem,1.2fr)] sm:items-end sm:gap-10">
          <h2
            id="shared-credit-title"
            className="text-2xl font-semibold tracking-[-0.04em] text-neutral-950 dark:text-neutral-50 sm:text-3xl"
          >
            Two students.
            <br />
            <span className="bg-gradient-to-r from-sky-700 via-violet-700 to-emerald-700 bg-clip-text text-transparent dark:from-sky-300 dark:via-violet-300 dark:to-emerald-300">
              One shared build.
            </span>
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            {DEVELOPERS_PROJECT.credit}
          </p>
        </div>
        <div
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-sky-300/70 via-violet-300/70 to-emerald-300/70 dark:from-sky-700/60 dark:via-violet-700/60 dark:to-emerald-700/60"
          aria-hidden
        />
      </motion.section>

      <section
        className="grid border-b border-neutral-200/80 dark:border-neutral-800/80 md:grid-cols-2 md:divide-x md:divide-neutral-200/80 md:dark:divide-neutral-800/80"
        aria-label="Equal contributors"
      >
        {DEVELOPERS.map((dev, index) => (
          <motion.article
            key={dev.id}
            {...reveal(0.08 + index * 0.06)}
            aria-labelledby={`developer-${dev.id}`}
            className={cn(
              'group py-7 sm:py-8 md:px-8 md:first:pl-0 md:last:pr-0',
              index > 0 && 'border-t border-neutral-200/80 dark:border-neutral-800/80 md:border-t-0'
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-full border border-violet-200/80',
                  'bg-gradient-to-br from-sky-50 via-violet-50 to-emerald-50',
                  'text-xs font-semibold text-violet-700 transition-[border-color,box-shadow] duration-200',
                  'group-hover:border-violet-300 group-hover:shadow-sm',
                  'dark:border-violet-900/70 dark:from-sky-950/60 dark:via-violet-950/60 dark:to-emerald-950/50',
                  'dark:text-violet-200 dark:group-hover:border-violet-700'
                )}
                aria-hidden
              >
                {dev.initials}
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-300">
                <span className="size-1.5 rounded-full bg-violet-500 dark:bg-violet-400" aria-hidden />
                {dev.role}
              </span>
            </div>

            <h3
              id={`developer-${dev.id}`}
              className="mt-6 text-xl font-semibold tracking-[-0.03em] text-neutral-950 dark:text-neutral-50 sm:text-2xl"
            >
              {dev.name}
            </h3>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
              {dev.bio}
            </p>

            {dev.links.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5" aria-label={`${dev.name} links`}>
                {dev.links.map((link) => (
                  <ConnectionLink key={link.href} link={link} reduceMotion={reduceMotion} />
                ))}
              </div>
            )}
          </motion.article>
        ))}
      </section>
    </div>
  );
};
