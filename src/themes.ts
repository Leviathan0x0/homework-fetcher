export type ThemeAppearance = 'light' | 'dark';

export interface ThemeSwatch {
  /** Page background behind every surface. */
  background: string;
  /** Raised card / panel colour. */
  surface: string;
  /** Accent used by buttons, links and highlights. */
  accent: string;
  /** Primary text colour. */
  foreground: string;
}

export interface AppTheme {
  id: string;
  name: string;
  description: string;
  mode: ThemeAppearance;
  swatch: ThemeSwatch;
  /** Colour reported to the browser chrome and PWA title bar. */
  themeColor: string;
}

export const THEMES: AppTheme[] = [
  {
    id: 'daylight',
    name: 'Daylight',
    description: 'The stock neutral palette with a soft off-white page.',
    mode: 'light',
    swatch: { background: '#f7f7f7', surface: '#ffffff', accent: '#18181b', foreground: '#171717' },
    themeColor: '#f7f7f7',
  },
  {
    id: 'ivory',
    name: 'Ivory',
    description: 'Warm paper tones with a bronze accent.',
    mode: 'light',
    swatch: { background: '#f7f3ea', surface: '#fffdf7', accent: '#8a6a2f', foreground: '#33290f' },
    themeColor: '#f7f3ea',
  },
  {
    id: 'blush',
    name: 'Blush',
    description: 'Soft rose pinks finished with a berry accent.',
    mode: 'light',
    swatch: { background: '#f9f1f4', surface: '#fffafb', accent: '#be3455', foreground: '#3a1520' },
    themeColor: '#f9f1f4',
  },
  {
    id: 'lavender',
    name: 'Lavender',
    description: 'Gentle lilac washes with a violet accent.',
    mode: 'light',
    swatch: { background: '#f4f1fb', surface: '#fcfaff', accent: '#6d3bd4', foreground: '#2a1747' },
    themeColor: '#f4f1fb',
  },
  {
    id: 'sky',
    name: 'Sky',
    description: 'Cool pale blues with a confident blue accent.',
    mode: 'light',
    swatch: { background: '#f1f6fd', surface: '#f8fbff', accent: '#2563d8', foreground: '#10254a' },
    themeColor: '#f1f6fd',
  },
  {
    id: 'mint',
    name: 'Mint',
    description: 'Fresh sea-glass greens with a teal accent.',
    mode: 'light',
    swatch: { background: '#f0faf5', surface: '#f5fdf9', accent: '#0f8a6d', foreground: '#0d3a30' },
    themeColor: '#f0faf5',
  },
  {
    id: 'peach',
    name: 'Peach',
    description: 'Sun-warmed apricot tones with a burnt-orange accent.',
    mode: 'light',
    swatch: { background: '#fdf4ec', surface: '#fffaf5', accent: '#d1651f', foreground: '#3f2110' },
    themeColor: '#fdf4ec',
  },
  {
    id: 'sand',
    name: 'Sand',
    description: 'Desert beige and olive for a grounded feel.',
    mode: 'light',
    swatch: { background: '#f1ebdd', surface: '#fbf7ec', accent: '#7a6428', foreground: '#322a14' },
    themeColor: '#f1ebdd',
  },
  {
    id: 'glacier',
    name: 'Glacier',
    description: 'Icy blue-grey surfaces with a steel accent.',
    mode: 'light',
    swatch: { background: '#f1f6f9', surface: '#f7fbfd', accent: '#2f6f95', foreground: '#142934' },
    themeColor: '#f1f6f9',
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Pure monochrome with crisp, high-contrast borders.',
    mode: 'light',
    swatch: { background: '#ffffff', surface: '#ffffff', accent: '#0a0a0a', foreground: '#000000' },
    themeColor: '#ffffff',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'The stock near-black neutral palette.',
    mode: 'dark',
    swatch: { background: '#09090b', surface: '#141417', accent: '#fafafa', foreground: '#f4f4f5' },
    themeColor: '#09090b',
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    description: 'Warm sepia-tinted greys with a bronze accent.',
    mode: 'dark',
    swatch: { background: '#17140f', surface: '#211c15', accent: '#e0b464', foreground: '#f0e9dd' },
    themeColor: '#17140f',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep navy surfaces with a bright sky accent.',
    mode: 'dark',
    swatch: { background: '#0a1220', surface: '#141f33', accent: '#4fa3ff', foreground: '#e6eefb' },
    themeColor: '#0a1220',
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Dark pine tones with a mint accent.',
    mode: 'dark',
    swatch: { background: '#0a1310', surface: '#12211b', accent: '#4ade9b', foreground: '#e4f3ec' },
    themeColor: '#0a1310',
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    description: 'Rich plum blacks with an orchid accent.',
    mode: 'dark',
    swatch: { background: '#150d1e', surface: '#221435', accent: '#c08bff', foreground: '#f1e7fd' },
    themeColor: '#150d1e',
  },
  {
    id: 'crimson',
    name: 'Crimson',
    description: 'Wine-dark surfaces with a rose-red accent.',
    mode: 'dark',
    swatch: { background: '#170b0e', surface: '#25131a', accent: '#ff7a92', foreground: '#f7e7ea' },
    themeColor: '#170b0e',
  },
  {
    id: 'solarized',
    name: 'Solarized',
    description: 'The classic teal-and-gold Solarized palette.',
    mode: 'dark',
    swatch: { background: '#002b36', surface: '#073642', accent: '#b58900', foreground: '#eee8d5' },
    themeColor: '#002b36',
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Cyberpunk violet blacks with electric cyan.',
    mode: 'dark',
    swatch: { background: '#0a0713', surface: '#181028', accent: '#34e7e4', foreground: '#e6fbff' },
    themeColor: '#0a0713',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Roasted amber and rust for late nights.',
    mode: 'dark',
    swatch: { background: '#17100a', surface: '#241a11', accent: '#ffa63d', foreground: '#f7ece0' },
    themeColor: '#17100a',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Phosphor green on true black.',
    mode: 'dark',
    swatch: { background: '#050a06', surface: '#0d1710', accent: '#45ff8a', foreground: '#d9ffe6' },
    themeColor: '#050a06',
  },
];

export const DEFAULT_THEME_ID: Record<ThemeAppearance, string> = {
  light: 'daylight',
  dark: 'midnight',
};

const THEMES_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return value === 'light' || value === 'dark';
}

export function getTheme(id: string | null | undefined): AppTheme | undefined {
  return id ? THEMES_BY_ID.get(id) : undefined;
}

export function themesForMode(mode: ThemeAppearance): AppTheme[] {
  return THEMES.filter((theme) => theme.mode === mode);
}

/**
 * Returns a theme id that is safe to apply for the given mode, falling back to
 * that mode's default when the stored id is missing or belongs to the other mode.
 */
export function resolveThemeId(id: string | null | undefined, mode: ThemeAppearance): string {
  const theme = getTheme(id);
  return theme && theme.mode === mode ? theme.id : DEFAULT_THEME_ID[mode];
}
