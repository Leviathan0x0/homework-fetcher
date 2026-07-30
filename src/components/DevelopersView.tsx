import React from 'react';
import { ExternalLink, Github, Globe, Linkedin, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
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
      return <BookOpen className={className} aria-hidden />;
    case 'x':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.743l7.725-8.835L1.254 2.25H8.08l4.251 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    default:
      return <ExternalLink className={className} aria-hidden />;
  }
}

function ConnectionLink({ link }: { link: DeveloperLink }) {
  return (
    <motion.a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ scale: 1.03, y: -1 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-neutral-200/80 dark:border-neutral-800',
        'bg-white/80 dark:bg-neutral-900/60 px-2.5 py-1.5 text-[11px] font-medium',
        'text-neutral-700 dark:text-neutral-200',
        'hover:border-neutral-300 dark:hover:border-neutral-700',
        'hover:bg-neutral-50 dark:hover:bg-neutral-800/80',
        'transition-colors duration-150 shadow-2xs'
      )}
    >
      <LinkIcon kind={link.kind} />
      <span>{link.label}</span>
      <ExternalLink className="size-3 opacity-40" aria-hidden />
    </motion.a>
  );
}

export const DevelopersView: React.FC = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
  };

  return (
    <motion.div
      className="space-y-6 max-w-3xl"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={itemVariants}>
        <PageHeader
          title="Meet the Developers"
          description={DEVELOPERS_PROJECT.blurb}
        />
      </motion.div>

      <section className="space-y-4" aria-label="Contributors">
        {DEVELOPERS.map((dev) => (
          <motion.article
            key={dev.id}
            variants={itemVariants}
            whileHover={{ scale: 1.01, translateY: -2 }}
            className={cn(
              'group relative overflow-hidden rounded-2xl border border-neutral-200/80 dark:border-neutral-800',
              'bg-white dark:bg-[#0c0c0e] shadow-2xs hover:shadow-xs transition-all duration-200'
            )}
          >
            <div
              className={cn(
                'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-50 group-hover:opacity-100 transition-opacity duration-300',
                dev.accentClass
              )}
              aria-hidden
            />
            <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-5 sm:p-6">
              <motion.div
                whileHover={{ rotate: 3, scale: 1.05 }}
                className={cn(
                  'flex size-12 shrink-0 items-center justify-center rounded-xl',
                  'bg-neutral-900 text-sm font-semibold tracking-wide text-white',
                  'dark:bg-neutral-100 dark:text-neutral-900 shadow-inner'
                )}
                aria-hidden
              >
                {dev.initials}
              </motion.div>

              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 transition-colors">
                    {dev.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{dev.role}</p>
                </div>
                <p className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {dev.bio}
                </p>
                {dev.links.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {dev.links.map((link) => (
                      <ConnectionLink key={link.href} link={link} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.article>
        ))}
      </section>
    </motion.div>
  );
};
