import React from 'react';
import { Code2, Github, Globe, Linkedin } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { PageHeader } from './PageHeader';
import { DEVELOPERS, DEVELOPERS_PROJECT, DeveloperLink, DeveloperLinkKind } from '../data/developers';
import { cn } from '../utils/cn';

function LinkIcon({ kind }: { kind: DeveloperLinkKind }) {
  const className = 'size-3.5 shrink-0';
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
        'text-neutral-600 transition-colors duration-200 hover:text-neutral-950',
        'focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40',
        'dark:text-neutral-400 dark:hover:text-neutral-100'
      )}
    >
      <LinkIcon kind={link.kind} />
      <span className="border-b border-neutral-200 pb-0.5 transition-colors duration-200 group-hover/link:border-neutral-500 dark:border-neutral-800 dark:group-hover/link:border-neutral-500">
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
        className="border-b border-neutral-200/80 pb-7 dark:border-neutral-800/80 sm:pb-9"
        aria-labelledby="shared-credit-title"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400 dark:text-neutral-500">
          Built together
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(18rem,1.2fr)] sm:items-end sm:gap-10">
          <h2
            id="shared-credit-title"
            className="text-2xl font-semibold tracking-[-0.04em] text-neutral-950 dark:text-neutral-50 sm:text-3xl"
          >
            Two students.
            <br />
            One shared build.
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            {DEVELOPERS_PROJECT.credit}
          </p>
        </div>
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
                  'flex size-10 items-center justify-center rounded-full border border-neutral-200',
                  'text-xs font-semibold text-neutral-700 transition-colors duration-200',
                  'group-hover:border-neutral-300 group-hover:bg-neutral-100/70',
                  'dark:border-neutral-800 dark:text-neutral-300 dark:group-hover:border-neutral-700 dark:group-hover:bg-neutral-900'
                )}
                aria-hidden
              >
                {dev.initials}
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-500">
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
