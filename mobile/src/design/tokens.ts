/**
 * Design tokens.
 *
 * Single source of truth for colour, spacing, radii and type. Screens must never
 * hard-code a hex value or a magic number — import from here so dark mode and
 * Dynamic Type keep working.
 */

export const spacing = {
  /** Hairline gaps, icon-to-label. */
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * Minimum touch target required by the accessibility bar. Anything tappable must
 * reach this in both axes, padding out from a smaller visual if needed.
 */
export const MIN_TOUCH_TARGET = 44;

export const durations = {
  /** Micro feedback: press states, chip toggles. */
  fast: 150,
  /** Default: sheets, row transitions, banner in/out. */
  normal: 200,
  /** Upper bound. Nothing in this app animates longer than this. */
  slow: 250,
} as const;

/** Spring config shared by every animated surface. Critically damped, no bounce. */
export const spring = {
  damping: 26,
  stiffness: 260,
  mass: 1,
} as const;

/**
 * Tight type scale. `lineHeight` is generous relative to size for dense reading.
 * `fontVariant: tabular-nums` is applied where numbers must align in columns.
 */
export const typography = {
  largeTitle: { fontSize: 32, lineHeight: 38, letterSpacing: 0.36, fontWeight: "700" },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.26, fontWeight: "700" },
  headline: { fontSize: 17, lineHeight: 23, letterSpacing: -0.43, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 23, letterSpacing: -0.31, fontWeight: "400" },
  callout: { fontSize: 15, lineHeight: 21, letterSpacing: -0.23, fontWeight: "400" },
  subhead: { fontSize: 14, lineHeight: 20, letterSpacing: -0.15, fontWeight: "500" },
  footnote: { fontSize: 13, lineHeight: 18, letterSpacing: -0.08, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: "500" },
} as const;

export type TypographyVariant = keyof typeof typography;

/**
 * Palette. Two complete sets so nothing falls back to a light value in dark mode.
 *
 * `glassTint` / `glassScrim` exist as a pair: the blur supplies the material and
 * the scrim guarantees text over it still clears WCAG AA. Never use one alone.
 */
export interface Palette {
  /** Base app background, behind scrolling content. */
  background: string;
  /** Raised card / row background. */
  surface: string;
  /** Pressed state for a surface. */
  surfacePressed: string;
  /** Subtle fill for chips, inputs, skeletons. */
  fill: string;
  fillStrong: string;

  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Text on top of `accent`. */
  textOnAccent: string;

  separator: string;
  /** Border for glass chrome — slightly brighter than `separator`. */
  glassBorder: string;

  accent: string;
  accentMuted: string;
  success: string;
  warning: string;
  danger: string;
  dangerMuted: string;

  /** BlurView tint keyword for this scheme. */
  glassTint: "light" | "dark" | "systemChromeMaterialLight" | "systemChromeMaterialDark";
  /** Legibility scrim painted over the blur. */
  glassScrim: string;
  /** Opaque stand-in used when blur is unavailable (older Android). */
  glassFallback: string;

  /** Full-screen dim behind a modal sheet or lightbox. */
  backdrop: string;

  /** Skeleton shimmer base. */
  skeleton: string;
}

export const lightPalette: Palette = {
  background: "#F5F5F7",
  surface: "#FFFFFF",
  surfacePressed: "#ECECEF",
  fill: "rgba(118,118,128,0.10)",
  fillStrong: "rgba(118,118,128,0.18)",

  text: "#0B0B0F",
  textSecondary: "rgba(60,60,67,0.68)",
  textTertiary: "rgba(60,60,67,0.42)",
  textOnAccent: "#FFFFFF",

  separator: "rgba(60,60,67,0.16)",
  glassBorder: "rgba(255,255,255,0.55)",

  accent: "#0A6CFF",
  accentMuted: "rgba(10,108,255,0.12)",
  success: "#1F9D55",
  warning: "#B25E00",
  danger: "#D22F2F",
  dangerMuted: "rgba(210,47,47,0.12)",

  glassTint: "systemChromeMaterialLight",
  glassScrim: "rgba(245,245,247,0.62)",
  glassFallback: "#FAFAFCF7",

  backdrop: "rgba(0,0,0,0.28)",
  skeleton: "rgba(118,118,128,0.14)",
};

export const darkPalette: Palette = {
  background: "#0B0B0F",
  surface: "#17171C",
  surfacePressed: "#22222A",
  fill: "rgba(118,118,128,0.22)",
  fillStrong: "rgba(118,118,128,0.34)",

  text: "#F5F5F7",
  textSecondary: "rgba(235,235,245,0.62)",
  textTertiary: "rgba(235,235,245,0.36)",
  textOnAccent: "#FFFFFF",

  separator: "rgba(235,235,245,0.16)",
  glassBorder: "rgba(255,255,255,0.10)",

  accent: "#3E8DFF",
  accentMuted: "rgba(62,141,255,0.18)",
  success: "#33C06B",
  warning: "#F0A33A",
  danger: "#FF6B60",
  dangerMuted: "rgba(255,107,96,0.18)",

  glassTint: "systemChromeMaterialDark",
  glassScrim: "rgba(11,11,15,0.58)",
  glassFallback: "#121218F7",

  backdrop: "rgba(0,0,0,0.55)",
  skeleton: "rgba(235,235,245,0.10)",
};
