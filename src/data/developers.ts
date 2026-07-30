export type DeveloperLinkKind = 'website' | 'x' | 'github' | 'linkedin' | 'devto' | 'other';

export interface DeveloperLink {
  kind: DeveloperLinkKind;
  label: string;
  href: string;
}

export interface DeveloperBadge {
  label: string;
  colorClass: string;
}

export interface Developer {
  id: string;
  name: string;
  role: string;
  tagline: string;
  bio: string;
  initials: string;
  avatarBg: string;
  accentGradient: string;
  borderHover: string;
  badge: DeveloperBadge;
  tags: string[];
  links: DeveloperLink[];
}

/** Edit this list to update the Meet the Developers page. */
export const DEVELOPERS: Developer[] = [
  {
    id: 'kiaan',
    name: 'Kiaan Mittal',
    role: 'Product & Design',
    tagline: 'UI Architecture & Product Strategy',
    bio: 'Student at MMSS Mohali. Builds AI tools and ships fast — creator of SignPaw, IndieTerminal, and this portal for the school.',
    initials: 'KM',
    avatarBg: 'bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sky-500/25',
    accentGradient: 'from-sky-500/10 via-blue-500/5 to-transparent dark:from-sky-400/10 dark:via-blue-400/5',
    borderHover: 'hover:border-sky-500/40 dark:hover:border-sky-500/30',
    badge: {
      label: 'Product Lead',
      colorClass: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
    },
    tags: ['SignPaw', 'IndieTerminal', 'UI Design', 'Frontend'],
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
    role: 'Core Systems & Backend',
    tagline: 'Systems Architecture & Infrastructure',
    bio: 'Student developer behind Chronicle MCP and core engineering on this homework portal. Building simple, reliable tools for school workflows.',
    initials: 'GB',
    avatarBg: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/25',
    accentGradient: 'from-emerald-500/10 via-teal-500/5 to-transparent dark:from-emerald-400/10 dark:via-teal-400/5',
    borderHover: 'hover:border-emerald-500/40 dark:hover:border-emerald-500/30',
    badge: {
      label: 'Engineering Lead',
      colorClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    },
    tags: ['Chronicle MCP', 'API Infrastructure', 'Realtime Sync', 'Data Models'],
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
    'Built 100% free for our school — homework tracking, classwork feeds, realtime messaging, and interactive planning in one unified experience.',
  repoUrl: 'https://github.com/Leviathan0x0/homework-fetcher',
  techStack: ['React 19', 'Vite', 'TypeScript', 'Tailwind CSS', 'Express', 'Drizzle ORM'],
};

