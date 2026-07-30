import React from 'react';
import { ExternalLink, Github, Globe, Linkedin, BookOpen, Sparkles, Code2, Heart } from 'lucide-react';
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
      whileHover={{ scale: 1.04, y: -1 }}
      whileTap={{ scale: 0.96 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-neutral-200/80 dark:border-neutral-800',
        'bg-neutral-50/80 dark:bg-neutral-900/60 px-2.5 py-1.5 text-[11px] font-medium',
        'text-neutral-700 dark:text-neutral-200',
        'hover:border-neutral-300 dark:hover:border-neutral-700',
        'hover:bg-white dark:hover:bg-neutral-800/90',
        'transition-all duration-150 shadow-2xs hover:shadow-xs'
      )}
    >
      <LinkIcon kind={link.kind} />
      {link.label}
      <ExternalLink className="size-3 opacity-40 ml-0.5" aria-hidden />
    </motion.a>
  );
}

export const DevelopersView: React.FC = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.12,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 26 } },
  };

  return (
    <motion.div
      className="space-y-8 max-w-4xl"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={itemVariants}>
        <PageHeader
          title="Meet the Developers"
          description={DEVELOPERS_PROJECT.blurb}
          badge={
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <Sparkles className="size-3" />
              100% Free & Open Source
            </span>
          }
        />
      </motion.div>

      {/* Developer Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-5" aria-label="Contributors">
        {DEVELOPERS.map((dev) => (
          <motion.article
            key={dev.id}
            variants={itemVariants}
            whileHover={{ y: -3 }}
            className={cn(
              'group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-neutral-200/80 dark:border-neutral-800/90',
              'bg-white dark:bg-[#0c0c0e] shadow-sm hover:shadow-md transition-all duration-300',
              dev.borderHover
            )}
          >
            {/* Ambient Background Glow */}
            <div
              className={cn(
                'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-40 group-hover:opacity-100 transition-opacity duration-500',
                dev.accentGradient
              )}
              aria-hidden
            />

            <div className="relative p-5 sm:p-6 space-y-4 flex-1">
              {/* Header inside card */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <motion.div
                    whileHover={{ rotate: 6, scale: 1.08 }}
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-xl font-bold text-sm tracking-wider shadow-sm',
                      dev.avatarBg
                    )}
                    aria-hidden
                  >
                    {dev.initials}
                  </motion.div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-white group-hover:text-neutral-950 dark:group-hover:text-white transition-colors">
                      {dev.name}
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{dev.role}</p>
                  </div>
                </div>

                <span
                  className={cn(
                    'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    dev.badge.colorClass
                  )}
                >
                  {dev.badge.label}
                </span>
              </div>

              {/* Tagline & Bio */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                  {dev.tagline}
                </p>
                <p className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                  {dev.bio}
                </p>
              </div>

              {/* Tags / Focus areas */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {dev.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800/60 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Links footer inside card */}
            <div className="relative border-t border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/30 px-5 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-1.5">
                {dev.links.map((link) => (
                  <ConnectionLink key={link.href} link={link} />
                ))}
              </div>
            </div>
          </motion.article>
        ))}
      </section>

      {/* Project & Tech Stack Banner */}
      <motion.section
        variants={itemVariants}
        className={cn(
          'relative overflow-hidden rounded-2xl border border-neutral-200/80 dark:border-neutral-800',
          'bg-gradient-to-r from-neutral-50 via-white to-neutral-50 dark:from-[#0f0f12] dark:via-[#0c0c0e] dark:to-[#0f0f12]',
          'p-5 sm:p-6 space-y-4 shadow-2xs'
        )}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
              <Code2 className="size-4 text-emerald-500" />
              <span>Built for MMSS Mohali</span>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-xl">
              This platform was created as a free community project to simplify homework tracking, messaging, and schedules. Made with <Heart className="size-3 inline text-rose-500 fill-rose-500/20" /> by students for students.
            </p>
          </div>

          <motion.a
            href={DEVELOPERS_PROJECT.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900',
              'px-4 py-2.5 text-xs font-semibold shadow-sm hover:opacity-95 transition-opacity shrink-0'
            )}
          >
            <Github className="size-4" aria-hidden />
            <span>GitHub Repository</span>
            <ExternalLink className="size-3 opacity-60" aria-hidden />
          </motion.a>
        </div>

        {/* Tech Stack Pills */}
        <div className="pt-2 border-t border-neutral-200/60 dark:border-neutral-800/60 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 mr-1">
            Tech Stack:
          </span>
          {DEVELOPERS_PROJECT.techStack.map((tech) => (
            <span
              key={tech}
              className="inline-flex items-center rounded-md border border-neutral-200/60 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-300"
            >
              {tech}
            </span>
          ))}
        </div>
      </motion.section>
    </motion.div>
  );
};

