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
  links: DeveloperLink[];
}

/** Edit this list to update the Meet the Developers page. */
export const DEVELOPERS: Developer[] = [
  {
    id: 'kiaan',
    name: 'Kiaan Mittal',
    role: 'Co-creator',
    bio: 'Student developer at MMSS Mohali and equal co-creator of this portal. Also builds practical tools including SignPaw and IndieTerminal.',
    initials: 'KM',
    links: [
      { kind: 'website', label: 'kiaanmittal.xyz', href: 'https://www.kiaanmittal.xyz/' },
      { kind: 'x', label: '@kiaan_mittal', href: 'https://x.com/kiaan_mittal' },
      { kind: 'github', label: '@Reelai-ha', href: 'https://github.com/Reelai-ha' },
      { kind: 'linkedin', label: 'kiaan-mittal', href: 'https://www.linkedin.com/in/kiaan-mittal-650157230' },
    ],
  },
  {
    id: 'guranshbir',
    name: 'Guranshbir Singh',
    role: 'Co-creator',
    bio: 'Student developer at MMSS Mohali and equal co-creator of this portal. Also builds practical tools including Chronicle MCP.',
    initials: 'GB',
    links: [
      { kind: 'website', label: 'guranshbir.dev', href: 'https://guranshbir.dev' },
      { kind: 'x', label: '@gsbrar_', href: 'https://x.com/gsbrar_' },
      { kind: 'github', label: '@Leviathan0x0', href: 'https://github.com/Leviathan0x0' },
      { kind: 'devto', label: 'leviathan0x0', href: 'https://dev.to/leviathan0x0' },
    ],
  },
];

export const DEVELOPERS_PROJECT = {
  name: 'MMSS Mohali Student Portal',
  blurb: 'Built free for our school - homework, classwork, messages, and planning in one place.',
  credit: 'Product decisions, design, engineering, testing, and iteration were shared work. Both developers shaped the portal and receive equal credit for the result.',
  repoUrl: 'https://github.com/Leviathan0x0/homework-fetcher',
};
