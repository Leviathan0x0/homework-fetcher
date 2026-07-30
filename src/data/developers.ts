export type DeveloperLinkKind = 'website' | 'x' | 'github' | 'linkedin' | 'devto' | 'other';

export interface DeveloperLink {
  kind: DeveloperLinkKind;
  label: string;
  href: string;
}

export interface Developer {
  id: string;
  name: string;
  role: string;
  bio: string;
  initials: string;
  accentClass: string;
  links: DeveloperLink[];
}

/** Edit this list to update the Meet the Developers page. */
export const DEVELOPERS: Developer[] = [
  {
    id: 'kiaan',
    name: 'Kiaan Mittal',
    role: 'Builder & product',
    bio: 'Student at MMSS Mohali. Builds AI tools and ships fast — SignPaw, IndieTerminal, and this portal for the school.',
    initials: 'KM',
    accentClass: 'from-sky-500/15 to-transparent dark:from-sky-400/10',
    links: [
      { kind: 'website', label: 'Website', href: 'https://www.kiaanmittal.xyz/' },
      { kind: 'x', label: 'X', href: 'https://x.com/kiaan_mittal' },
      { kind: 'github', label: 'GitHub', href: 'https://github.com/Reelai-ha' },
      { kind: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/kiaan-mittal-650157230' },
    ],
  },
  {
    id: 'guranshbir',
    name: 'Guranshbir',
    role: 'Engineering',
    bio: 'Student developer behind Chronicle MCP and core work on this homework portal. Building tools that keep school workflows simple.',
    initials: 'GB',
    accentClass: 'from-emerald-500/15 to-transparent dark:from-emerald-400/10',
    links: [
      { kind: 'website', label: 'Website', href: 'https://guranshbir.dev' },
      { kind: 'x', label: 'X', href: 'https://x.com/gsbrar_' },
      { kind: 'github', label: 'GitHub', href: 'https://github.com/Leviathan0x0' },
      { kind: 'devto', label: 'DEV', href: 'https://dev.to/leviathan0x0' },
    ],
  },
];

export const DEVELOPERS_PROJECT = {
  name: 'MMSS Mohali Student Portal',
  blurb:
    'Built free for our school — homework, classwork, messages, and planning in one place. Made by students, for students.',
  repoUrl: 'https://github.com/Leviathan0x0/homework-fetcher',
};
